/**
 * EnergyBaselineMath — Phase 20 pure / read-only helpers for EnergyBaselineService.
 *
 * Split out of `energyBaselineService.ts` to keep that file under the 500-line
 * CLAUDE.md cap. Contains row mappers, `freezeBaselineEvidence` (BLOCKER-01
 * Option B), Plan 04 savings-side read helpers, and Plan 02 pure-math helpers.
 * No writes — all DB writes for Phase 20 stay in `energyBaselineService.ts`.
 *
 * @see .planning/phases/20-energy-baseline-savings/20-RESEARCH.md
 * @see .planning/phases/20-energy-baseline-savings/20-CONTEXT.md D-07 (cost/CO2 freeze)
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { EnergyConfigService } from './energyConfigService.js';
import { EnergyTariffService } from './energyTariffService.js';
import {
  BaselineOverlapError,
  MeasurementTooShortError,
} from './errors.js';
import type {
  BaselineWarning,
  IBaselineDailyPoint,
  IBaselineEvidence,
  IEnergyBaseline,
  IEnergyConfigPeriod,
  ISavingsResponse,
} from '@wpt/types';

// Row mappers — pg row → typed Phase 20 interfaces. Number() coerces BIGSERIAL
// (sometimes string from the driver) and REAL columns at the read boundary.

/** Coerce a raw pg row into IEnergyBaseline. */
export function mapRowToBaseline(row: Record<string, unknown>): IEnergyBaseline {
  return {
    baselineId: Number(row.baseline_id),
    label: String(row.label),
    periodFrom: row.period_from instanceof Date
      ? row.period_from
      : new Date(row.period_from as string),
    periodTo: row.period_to instanceof Date
      ? row.period_to
      : new Date(row.period_to as string),
    lockedAt: row.locked_at instanceof Date
      ? row.locked_at
      : new Date(row.locked_at as string),
    retiredAt: row.retired_at == null
      ? null
      : (row.retired_at instanceof Date
        ? row.retired_at
        : new Date(row.retired_at as string)),
    justification: row.justification == null ? null : String(row.justification),
    normalizationVariables: (row.normalization_variables ?? {}) as Record<string, unknown>,
    createdBy: row.created_by == null ? null : String(row.created_by),
  };
}

/** Coerce a raw pg row into IBaselineEvidence. REAL/bigint columns coerced via Number(). */
export function mapRowToEvidence(row: Record<string, unknown>): IBaselineEvidence {
  return {
    baselineId: Number(row.baseline_id),
    totalKwh: Number(row.total_kwh),
    totalKg: Number(row.total_kg),
    totalCycles: Number(row.total_cycles),
    enpi: Number(row.enpi),
    totalEur: Number(row.total_eur),
    totalKgco2: Number(row.total_kgco2),
    dailySeries: (row.daily_series ?? []) as IBaselineDailyPoint[],
    lockedAt: row.locked_at instanceof Date
      ? row.locked_at
      : new Date(row.locked_at as string),
  };
}

// freezeBaselineEvidence — read-only snapshot builder. Walks the union of
// energy_1d daily buckets and cycle_records daily rollups (Europe/Rome local
// days), then per-day computes EUR / kgCO2 via the energy_config_periods row
// in force that day (D-07 cost/CO2 freeze).

interface IFrozenBaselineEvidence {
  dailySeries: IBaselineDailyPoint[];
  totalKwh: number;
  totalKg: number;
  totalCycles: number;
  totalEur: number;
  totalKgco2: number;
  dataGapRatio: number;
}

/**
 * Build the frozen daily_series + scalar totals + data_gap_ratio for a
 * baseline window. Read-only — Phase 20 writes stay inside `lockBaseline`'s TX.
 *
 * BLOCKER-01 (data_gap_ratio Option B): expectedBuckets = ceil(window / 1d);
 * actualBuckets = energy_1d row count; dataGapRatio = clamp(0,1, 1 - actual/expected).
 *
 * WARNING 1 (cycles-only-day symmetry): the iterator below walks the UNION of
 * energy_1d days AND cycle_records days, so days with cycles-only (energy_1d
 * gap from CA lag / PLC outage) still contribute their cycle.kg, keeping the
 * baseline EnPI denominator symmetric with measurement-side sumAttributedKgInWindow.
 */
export async function freezeBaselineEvidence(
  periodFrom: Date,
  periodTo: Date,
): Promise<IFrozenBaselineEvidence> {
  // ---- Step A: energy_1d rows in [periodFrom, periodTo) ----
  const energyRows = await db.execute(sql`
    SELECT bucket_1d, COALESCE(kwh_delta, 0)::float8 AS kwh_delta
    FROM energy_1d
    WHERE bucket_1d >= ${periodFrom.toISOString()}::timestamptz
      AND bucket_1d <  ${periodTo.toISOString()}::timestamptz
    ORDER BY bucket_1d
  `);

  // ---- Step B: cycle_records daily rollups in the same window (Europe/Rome) ----
  const cycleRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', started_at AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD') AS day,
      COALESCE(SUM(material_output_kg), 0)::float8 AS kg,
      COUNT(*)::int AS cycles_count
    FROM cycle_records
    WHERE attribution_status = 'ATTRIBUTED'
      AND material_output_kg > 0
      AND started_at >= ${periodFrom.toISOString()}::timestamptz
      AND started_at <  ${periodTo.toISOString()}::timestamptz
    GROUP BY 1
    ORDER BY 1
  `);

  // ---- Step C: index BOTH result sets by Europe/Rome YYYY-MM-DD day key ----
  const energyByDay = new Map<string, { kwh: number; dayDate: Date }>();
  for (const r of energyRows.rows as Array<{
    bucket_1d: string | Date;
    kwh_delta: number | string;
  }>) {
    const dayDate = r.bucket_1d instanceof Date
      ? r.bucket_1d
      : new Date(r.bucket_1d);
    const key = dayDate.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    energyByDay.set(key, { kwh: Number(r.kwh_delta), dayDate });
  }
  const cycleByDay = new Map<string, { kg: number; cyclesCount: number }>();
  for (const r of cycleRows.rows as Array<{
    day: string;
    kg: number | string;
    cycles_count: number | string;
  }>) {
    cycleByDay.set(r.day, {
      kg: Number(r.kg),
      cyclesCount: Number(r.cycles_count),
    });
  }

  // ---- Step D: period cache keyed by validFrom (period cache pattern from
  //              energyAggregateService.getAggregate lines 141-165) ----
  const periodCacheByValidFrom = new Map<string, IEnergyConfigPeriod>();
  const getPeriodForDay = async (dayDate: Date): Promise<IEnergyConfigPeriod> => {
    const period = await EnergyConfigService.getActivePeriod(dayDate);
    const key = period.validFrom instanceof Date
      ? period.validFrom.toISOString()
      : String(period.validFrom);
    const cached = periodCacheByValidFrom.get(key);
    if (cached) return cached;
    periodCacheByValidFrom.set(key, period);
    return period;
  };

  // ---- Step E: build daily_series by iterating ALL unique calendar days ----
  // ISO YYYY-MM-DD strings sort lexicographically.
  const allDayKeys = new Set<string>([
    ...energyByDay.keys(),
    ...cycleByDay.keys(),
  ]);
  const sortedDayKeys = [...allDayKeys].sort();

  const dailySeries: IBaselineDailyPoint[] = [];
  let totalKwh = 0;
  let totalKg = 0;
  let totalCycles = 0;
  let totalEur = 0;
  let totalKgco2 = 0;

  for (const dayKey of sortedDayKeys) {
    const energy = energyByDay.get(dayKey);
    const cycle = cycleByDay.get(dayKey) ?? { kg: 0, cyclesCount: 0 };
    const kwh = energy?.kwh ?? 0;
    // Anchor day for tariff lookup: prefer the energy bucket's actual
    // timestamp; fall back to NOON UTC of the cycle-day key if no energy
    // row exists. Noon UTC is far from any DST midnight boundary, so the
    // tariff period lookup (which uses the calendar year / day) is robust
    // whether `dayKey` falls in CET (+01:00) or CEST (+02:00). The earlier
    // `+01:00` anchor silently mis-bucketed summer orphan days at DST-boundary
    // tariff periods (WR-01).
    const dayDate = energy?.dayDate ?? new Date(`${dayKey}T12:00:00Z`);
    const period = await getPeriodForDay(dayDate);
    const eur = kwh > 0
      ? EnergyTariffService.computeCostFromPeriod(kwh, dayDate, period)
      : 0;
    const kgco2 = kwh > 0
      ? EnergyTariffService.computeCo2FromPeriod(kwh, period)
      : 0;

    dailySeries.push({
      date: dayKey,
      kwh,
      kg: cycle.kg,
      cyclesCount: cycle.cyclesCount,
      eur,
      kgco2,
    });

    totalKwh += kwh;
    totalKg += cycle.kg;
    totalCycles += cycle.cyclesCount;
    totalEur += eur;
    totalKgco2 += kgco2;
  }

  // ---- Step F: BLOCKER-01 Option B — data_gap_ratio via missing-bucket proxy ----
  const expectedBuckets = Math.ceil(
    (periodTo.getTime() - periodFrom.getTime()) / 86_400_000,
  );
  const actualBuckets = energyRows.rows.length;
  const dataGapRatio = expectedBuckets > 0
    ? Math.max(0, Math.min(1, 1 - actualBuckets / expectedBuckets))
    : 0;

  return {
    dailySeries,
    totalKwh,
    totalKg,
    totalCycles,
    totalEur,
    totalKgco2,
    dataGapRatio,
  };
}

// Plan 04 — savings-side read helpers backing EnergyBaselineService.computeSavings.
// `_` prefix is the Phase 19 unit-test convention.

/** Read the baseline_evidence row for a given baseline_id. Null if not found. */
export async function _fetchEvidenceByBaselineId(
  baselineId: number,
): Promise<IBaselineEvidence | null> {
  const result = await db.execute(sql`
    SELECT baseline_id, total_kwh, total_kg, total_cycles, enpi,
           total_eur, total_kgco2, daily_series, locked_at
    FROM baseline_evidence
    WHERE baseline_id = ${baselineId}::bigint
  `);
  if (result.rows.length === 0) return null;
  return mapRowToEvidence(result.rows[0] as Record<string, unknown>);
}

/** Sum energy_1d.kwh_delta over [from, to). Phase 20-private. */
export async function _sumEnergy1dKwhInWindow(
  from: Date,
  to: Date,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(kwh_delta), 0)::float8 AS total
    FROM energy_1d
    WHERE bucket_1d >= ${from.toISOString()}::timestamptz
      AND bucket_1d <  ${to.toISOString()}::timestamptz
  `);
  const row = result.rows[0] as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

/**
 * Build the detail=1 measurement daily series with the constant baseline
 * reference line (RESEARCH Open Question 3: flat horizontal at baseline.enpi).
 * Each entry is a Europe/Rome calendar day with the per-day measurement
 * EnPI (kwh/kg) and the constant baseline EnPI for the chart.
 */
export async function _buildMeasurementDailySeries(
  from: Date,
  to: Date,
  baselineEnpi: number,
): Promise<
  Array<{ date: string; baselineKwhPerKg: number; measurementKwhPerKg: number }>
> {
  const energyRows = await db.execute(sql`
    SELECT to_char(bucket_1d AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS day,
           COALESCE(kwh_delta, 0)::float8 AS kwh
    FROM energy_1d
    WHERE bucket_1d >= ${from.toISOString()}::timestamptz
      AND bucket_1d <  ${to.toISOString()}::timestamptz
    ORDER BY bucket_1d
  `);
  const cycleRows = await db.execute(sql`
    SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD') AS day,
           COALESCE(SUM(material_output_kg), 0)::float8 AS kg
    FROM cycle_records
    WHERE attribution_status = 'ATTRIBUTED'
      AND material_output_kg > 0
      AND started_at >= ${from.toISOString()}::timestamptz
      AND started_at <  ${to.toISOString()}::timestamptz
    GROUP BY 1
    ORDER BY 1
  `);
  const kgByDay = new Map<string, number>();
  for (const r of cycleRows.rows as Array<{ day: string; kg: number | string }>) {
    kgByDay.set(r.day, Number(r.kg));
  }
  const series: Array<{
    date: string;
    baselineKwhPerKg: number;
    measurementKwhPerKg: number;
  }> = [];
  for (const r of energyRows.rows as Array<{ day: string; kwh: number | string }>) {
    const kg = kgByDay.get(r.day) ?? 0;
    const kwh = Number(r.kwh);
    const measurementKwhPerKg = kg > 0 ? kwh / kg : 0;
    series.push({
      date: r.day,
      baselineKwhPerKg: baselineEnpi, // constant reference line
      measurementKwhPerKg,
    });
  }
  return series;
}

// Pure-math helpers (Plan 02) — moved here from energyBaselineService.ts after
// Plan 04 added the full computeSavings flow (500-line cap). Error classes
// stay in the service module (route mapper `instanceof` checks); these helpers
// `throw new` them via the circular import at the top.

interface IScalarsInput {
  baseline: {
    enpi: number;
    totalKwh: number;
    totalKg: number;
    normalizationVariables: Record<string, unknown>;
    periodFrom: Date;
    periodTo: Date;
    baselineId: number;
    label: string;
  };
  measurement: { totalKwh: number; totalKg: number };
  baselineEurPerKwh: number;
  baselineKgCO2PerKwh: number;
  windowFrom: Date;
  windowTo: Date;
}

interface IValidationInput {
  baselinePeriodTo: Date;
  measurementFrom: Date;
  measurementTo: Date;
}

/**
 * Hard-reject savings computation when the input windows are invalid (ENBL-03).
 *
 * Rules enforced here:
 *  - No overlap: `baselinePeriodTo < measurementFrom` required (Pitfall 5b)
 *  - Measurement window must be at least 7 days long
 *
 * NOT enforced here (lives in `lockBaseline` — Plan 03):
 *  - Baseline window >= 14 days (this function does not receive `baselinePeriodFrom`)
 *
 * @throws {BaselineOverlapError} when windows overlap
 * @throws {MeasurementTooShortError} when measurement window < 7 days
 */
export function _validateSavingsWindows(input: IValidationInput): void {
  if (input.baselinePeriodTo.getTime() >= input.measurementFrom.getTime()) {
    throw new BaselineOverlapError(
      'Measurement window overlaps baseline window — required: baseline.period_to < measurement_from',
      {
        baselinePeriodTo: input.baselinePeriodTo.toISOString(),
        measurementFrom: input.measurementFrom.toISOString(),
      },
    );
  }
  // DST-aware day count (WR-05):
  // A wall-clock 7-day window crossing the spring-forward DST boundary is
  // only 167 h of elapsed time (6 days 23 h = 601_200_000 ms), which trips
  // a naive `measurementMs >= 7 * 86_400_000` check even though the user
  // picked two wall-clock midnights 7 calendar days apart. Add a 1-hour
  // slack before floor-dividing so the spring-forward window rounds up to
  // 7 calendar days. The slack is precisely the DST skew — a genuine
  // flat-6-day window (6 * 86_400_000 = 518_400_000 ms) still floors to
  // 6 and is rejected. A fall-back 7-day window (7 * 86_400_000 +
  // 3_600_000 ms) is trivially accepted. Symmetric with the `+01:00` WR-01
  // DST fix in `freezeBaselineEvidence`.
  const measurementMs = input.measurementTo.getTime() - input.measurementFrom.getTime();
  const measurementDays = Math.floor(
    (measurementMs + 3_600_000) / 86_400_000,
  );
  if (measurementDays < 7) {
    throw new MeasurementTooShortError(
      'Measurement window must be at least 7 days',
      {
        measurementFrom: input.measurementFrom.toISOString(),
        measurementTo: input.measurementTo.toISOString(),
        daysRequired: 7,
        daysProvided: measurementMs / 86_400_000,
      },
    );
  }
}

/**
 * Pure synchronous savings math. No DB, no Date.now(), no side effects.
 *
 * Formula:
 *   measurementEnpi = measurement.totalKwh / measurement.totalKg
 *   deltaPct        = ((measurementEnpi - baseline.enpi) / baseline.enpi) * 100
 *   deltaKwh        = measurement.totalKwh - (baseline.enpi * measurement.totalKg)
 *   deltaEur        = deltaKwh * baselineEurPerKwh  (tariff frozen at lock time)
 *   deltaKgco2      = deltaKwh * baselineKgCO2PerKwh (factor frozen at lock time)
 *
 * Sign convention: NEGATIVE means better than baseline (consumption went down).
 * ENBL-05 — the route handler/frontend renders positive/negative coloring,
 * NEVER a bare minus sign.
 *
 * Pitfall 5d guard: `measurement.totalKg <= 0` throws `MeasurementTooShortError`
 * deterministically. The ATTRIBUTED filter in `sumAttributedKgInWindow` should
 * prevent this in practice, but the guard is belt-and-suspenders.
 *
 * confidence='LOW' when baseline.normalizationVariables is empty (ENBL-04).
 *
 * @throws {MeasurementTooShortError} on zero/negative denominator or zero baseline EnPI
 */
export function _computeSavingsFromScalars(input: IScalarsInput): ISavingsResponse {
  if (input.measurement.totalKg <= 0) {
    throw new MeasurementTooShortError(
      'No attributed production in measurement window',
      {
        totalKg: input.measurement.totalKg,
        totalKwh: input.measurement.totalKwh,
      },
    );
  }
  if (input.baseline.enpi <= 0) {
    throw new MeasurementTooShortError(
      'Baseline EnPI is zero — cannot compute percentage delta',
      { baselineEnpi: input.baseline.enpi, baselineId: input.baseline.baselineId },
    );
  }

  const measurementEnpi = input.measurement.totalKwh / input.measurement.totalKg;
  const deltaPct = ((measurementEnpi - input.baseline.enpi) / input.baseline.enpi) * 100;
  const deltaKwh = input.measurement.totalKwh - input.baseline.enpi * input.measurement.totalKg;
  const deltaEur = deltaKwh * input.baselineEurPerKwh;
  const deltaKgco2 = deltaKwh * input.baselineKgCO2PerKwh;
  const confidence: 'HIGH' | 'LOW' =
    Object.keys(input.baseline.normalizationVariables).length === 0 ? 'LOW' : 'HIGH';

  return {
    baselineId: input.baseline.baselineId,
    baselineLabel: input.baseline.label,
    baselineEnpi: input.baseline.enpi,
    measurementEnpi,
    deltaPct,
    deltaKwh,
    deltaEur,
    deltaKgco2,
    confidence,
    windowFrom: input.windowFrom.toISOString(),
    windowTo: input.windowTo.toISOString(),
    excludedStatuses: ['ABORTED', 'TOO_SHORT', 'DATA_GAP', 'UNKNOWN'],
  };
}

/**
 * Compute soft quality warnings for a baseline lock (D-11).
 * NON-blocking — the lock succeeds regardless. Warnings surface in the
 * response body for the SUPER_ADMIN UI to render as a yellow banner.
 *
 * Thresholds:
 *  - cycle_count < 20      → LOW_CYCLE_COUNT  (Pitfall 5c — non-representative sample)
 *  - data_gap_ratio > 0.05 → HIGH_DATA_GAP_RATIO (>5% unaccounted buckets)
 *
 * Pure synchronous — no DB, no Date.now(), no side effects.
 */
export function _computeSoftWarnings(input: {
  cycleCount: number;
  dataGapRatio: number;
}): BaselineWarning[] {
  const warnings: BaselineWarning[] = [];
  if (input.cycleCount < 20) warnings.push('LOW_CYCLE_COUNT');
  if (input.dataGapRatio > 0.05) warnings.push('HIGH_DATA_GAP_RATIO');
  return warnings;
}
