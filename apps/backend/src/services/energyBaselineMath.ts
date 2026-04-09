/**
 * EnergyBaselineMath
 *
 * Phase 20 — Pure / read-only helpers for EnergyBaselineService.
 *
 * Split out of `energyBaselineService.ts` to keep that file under the
 * 500-line CLAUDE.md cap. This file contains:
 *
 *  1. `mapRowToBaseline` — pg row → IEnergyBaseline coercion
 *  2. `mapRowToEvidence` — pg row → IBaselineEvidence coercion
 *  3. `freezeBaselineEvidence` — read-only daily-series + scalar totals +
 *     data_gap_ratio (BLOCKER-01 Option B) snapshot for a baseline window.
 *
 * No writes happen here — all DB writes for Phase 20 stay in
 * `energyBaselineService.ts` (`lockBaseline` is the only writer, and its
 * BEGIN/COMMIT TX wraps the retire+inserts).
 *
 * @see .planning/phases/20-energy-baseline-savings/20-RESEARCH.md
 * @see .planning/phases/20-energy-baseline-savings/20-CONTEXT.md D-07 (cost/CO2 freeze)
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { EnergyConfigService } from './energyConfigService.js';
import { EnergyTariffService } from './energyTariffService.js';
import type {
  IBaselineDailyPoint,
  IBaselineEvidence,
  IEnergyBaseline,
  IEnergyConfigPeriod,
} from '@wpt/types';

// =============================================================================
// Row mappers — coerce raw pg rows (with potential bigint-as-string from the
// driver) into typed Phase 20 interfaces. Mirrors the pattern in
// `energyConfigService.getActivePeriod` where REAL columns are also coerced
// via Number() at the read boundary.
// =============================================================================

/**
 * Coerce a raw pg row (where BIGSERIAL arrives as string in some driver versions)
 * into IEnergyBaseline. Uses `Number()` for bigint coerce, matching the
 * energyConfigService.ts REAL-column pattern.
 */
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

/**
 * Coerce a raw pg row into IBaselineEvidence. REAL columns may arrive as
 * strings; bigint baseline_id may arrive as string.
 */
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

// =============================================================================
// freezeBaselineEvidence — read-only snapshot builder for the baseline
// evidence row. Walks the union of energy_1d daily buckets and cycle_records
// daily rollups (Europe/Rome local days), then per-day computes EUR / kgCO2
// via the energy_config_periods row in force that day (D-07 cost/CO2 freeze).
// =============================================================================

export interface IFrozenBaselineEvidence {
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
 * baseline window. Does not write to any table — the only writes for
 * Phase 20 stay inside `lockBaseline`'s atomic transaction.
 *
 * BLOCKER-01 resolution: data_gap_ratio is computed via Option B (missing-bucket
 * proxy):
 *   expectedBuckets = ceil((period_to - period_from) / 86_400_000)
 *   actualBuckets   = energy_1d row count (NOT outer-joined day count)
 *   dataGapRatio    = clamp(0, 1, 1 - actualBuckets/expectedBuckets)
 *
 * WARNING 1 (cycles-only-day symmetry): the calendar-day iterator below
 * walks the UNION of energy_1d days AND cycle_records days. Days with
 * cycles-only (energy_1d gap from totalizer CA lag or PLC outage) still
 * contribute their cycle.kg / cycle.cyclesCount. Without this symmetry the
 * baseline EnPI denominator under-counts kg vs the measurement-side
 * sumAttributedKgInWindow (which has NO energy_1d filter), making the
 * baseline EnPI artificially HIGH and future measurements look artificially
 * WORSE — the opposite of the ISO 50001 auditability intent.
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
    // timestamp; fall back to midnight Europe/Rome of the cycle-day if no
    // energy row exists. Europe/Rome is UTC+1 (winter) / UTC+2 (summer);
    // using "+01:00" is safe because the period lookup uses the calendar
    // year, not the wall-clock hour.
    const dayDate = energy?.dayDate ?? new Date(`${dayKey}T00:00:00+01:00`);
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
