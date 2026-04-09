import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { EnergyConfigService } from './energyConfigService.js';
import { EnergyTariffService } from './energyTariffService.js';
import {
  formatItKwh,
  formatItEur,
  formatItKgCO2,
} from '@wpt/types';
import type {
  IEnergyAggregateResponse,
  IEnergyAggregateRow,
  IEnergyConfigPeriod,
  EnergyBucket,
} from '@wpt/types';

/**
 * EnergyAggregateService — read-only aggregate queries against the
 * energy_5min / energy_1h / energy_1d / energy_1mo continuous-aggregate
 * hierarchy created by Plans 19-08 and 19-09, joined at query time with
 * the active `energy_config_periods` row (Plan 19-04) to compute cost (€)
 * and CO₂ (kg) per bucket per ECFG-03 / ECFG-04.
 *
 * ALL methods take their anchor timestamps as explicit parameters. The
 * service NEVER reads the ambient wall clock — (from, to, bucket)
 * arguments fully determine the output, so two invocations with identical
 * inputs against an unchanged DB return byte-identical results. That is
 * the ECFG-03 reproducibility contract the Phase 22 PDF regeneration
 * depends on.
 *
 * sql.raw() is used ONLY for the view name + bucket column identifier,
 * both of which come from the static CAGG_BY_BUCKET lookup (not user
 * input). User-supplied dates flow through Drizzle's parameterized
 * template literal interpolation (`${opts.from}::timestamptz`), which is
 * safe. This mirrors the existing chartService.ts pattern at
 * wpt-iot/apps/backend/src/services/chartService.ts:189.
 *
 * Closes the read-side of ENRG-01 (all 4 CAGG levels queryable), ENRG-06
 * (reconciliation math), and ENRG-07 (rolling p10 idle baseload per
 * CONTEXT D-18). Consumed by Plan 19-10's /api/energy/aggregate route
 * handler and by the Phase 21 reconciliation widget.
 */

interface IRawAggRow {
  bucket: Date | string;
  kwh_delta: number | string | null;
  sample_count: number | string | null;
}

const MIN_VALID_RMS_CURRENT_A = 0;
const MAX_VALID_RMS_CURRENT_A = 1000;
const MIN_VALID_PHASE_COUNT = 2;

export interface IReconciliationResult {
  /** Total metered kWh over [from, to) — sum of energy_1d.kwh_delta rows. */
  meterKwh: number;
  /** kWh attributed to ATTRIBUTED cycles in the window (cycle_records). */
  cycleKwh: number;
  /** kWh not attributable to cycles — meter minus cycle minus unknown, clipped at 0. */
  idleKwh: number;
  /** kWh attributed to UNKNOWN / ABORTED / TOO_SHORT / DATA_GAP cycles. */
  unknownKwh: number;
  /**
   * (cycleKwh + idleKwh) / meterKwh — target >= 0.98 on a clean day.
   * 0 when meterKwh is 0.
   */
  ratio: number;
}

export interface IIdleBaseloadResult {
  /** p10 idle baseload in kW, or null if the window has no sampled rows. */
  kw: number | null;
  /** Power factor used for the derivation (from energy_config.cosphi). */
  cosphi: number;
  /** The [from, to) window the p10 was computed over. */
  windowFrom: Date;
  windowTo: Date;
}

export class EnergyAggregateService {
  /**
   * Closed static lookup mapping the Zod-validated bucket enum to the
   * underlying CAGG view name and its bucket column alias. Plan 19-08
   * uses `bucket` as the Level-1 alias; Plan 19-09 uses `bucket_1h` /
   * `bucket_1d` / `bucket_1mo` at Levels 2-4 so every CA-on-CA query is
   * unambiguous.
   *
   * Any value interpolated via `sql.raw(...)` MUST come from this map —
   * never from user input. See file header for the chartService.ts
   * pattern reference.
   */
  private static readonly CAGG_BY_BUCKET: Record<
    EnergyBucket,
    { view: string; bucketCol: string }
  > = {
    '5min': { view: 'energy_5min', bucketCol: 'bucket' },
    hour: { view: 'energy_1h', bucketCol: 'bucket_1h' },
    day: { view: 'energy_1d', bucketCol: 'bucket_1d' },
    month: { view: 'energy_1mo', bucketCol: 'bucket_1mo' },
  };

  /**
   * Query the CAGG view for `opts.bucket` over [from, to), join each row
   * with the tariff period active at the row's bucket timestamp, and
   * return a fully-populated IEnergyAggregateResponse with Italian-locale
   * display strings pre-formatted via the Plan 19-02 helpers.
   *
   * Cost and CO₂ are computed row-by-row using the period that contains
   * the bucket's own timestamp, NOT the period active at query time —
   * that is the ECFG-03 reproducibility gate. Regenerating yesterday's
   * aggregate tomorrow produces numerically identical output even if the
   * tariff changed this morning.
   *
   * Negative bucket deltas (possible in the rare case where a CAGG
   * materializes a reset boundary bucket) are clipped to 0 to avoid
   * negative costs flowing to the PDF. Plan 19-12 / v1.2 may alert on
   * these separately.
   */
  static async getAggregate(opts: {
    from: Date;
    to: Date;
    bucket: EnergyBucket;
  }): Promise<IEnergyAggregateResponse> {
    const cfg = EnergyAggregateService.CAGG_BY_BUCKET[opts.bucket];

    // User-supplied dates flow through parameterized template literals
    // (`${opts.from}::timestamptz`); sql.raw() wraps ONLY the view and
    // bucket-column identifiers from the closed CAGG_BY_BUCKET map.
    const rawRows = await db.execute(
      sql`SELECT ${sql.raw(cfg.bucketCol)} AS bucket,
                 kwh_delta,
                 sample_count
          FROM ${sql.raw(cfg.view)}
          WHERE ${sql.raw(cfg.bucketCol)} >= ${opts.from}::timestamptz
            AND ${sql.raw(cfg.bucketCol)} <  ${opts.to}::timestamptz
          ORDER BY ${sql.raw(cfg.bucketCol)}`,
    );

    // Cache the active period lookup by calendar day so a 288-bucket
    // 5min-day query does not hit energy_config_periods 288 times. The
    // cache is correct because periods are half-open intervals anchored
    // to calendar instants — two buckets on the same local day always
    // resolve to the same period row unless someone inserted a
    // mid-day period, which Phase 23 /settings/energy does not allow.
    const periodCache = new Map<string, IEnergyConfigPeriod>();

    const rows: IEnergyAggregateRow[] = [];
    let totalKwh = 0;
    let totalCost = 0;
    let totalCo2 = 0;

    for (const raw of rawRows.rows as unknown as IRawAggRow[]) {
      // pg driver can return REAL as string — coerce defensively so
      // downstream arithmetic is numeric, not string-concat.
      const kwhDeltaRaw =
        raw.kwh_delta == null ? 0 : Number(raw.kwh_delta);
      const kwhDelta = Number.isFinite(kwhDeltaRaw)
        ? Math.max(0, kwhDeltaRaw)
        : 0;
      const bucketDate = raw.bucket instanceof Date
        ? raw.bucket
        : new Date(raw.bucket as string);

      const cacheKey = bucketDate.toISOString().slice(0, 10);
      let period = periodCache.get(cacheKey);
      if (!period) {
        period = await EnergyConfigService.getActivePeriod(bucketDate);
        periodCache.set(cacheKey, period);
      }

      const costEur = EnergyTariffService.computeCostFromPeriod(
        kwhDelta,
        bucketDate,
        period,
      );
      const co2Kg = EnergyTariffService.computeCo2FromPeriod(kwhDelta, period);

      const sampleCount =
        raw.sample_count == null ? 0 : Number(raw.sample_count);

      rows.push({
        bucket: bucketDate,
        kwhDelta,
        costEur,
        co2Kg,
        sampleCount: Number.isFinite(sampleCount) ? sampleCount : 0,
      });

      totalKwh += kwhDelta;
      totalCost += costEur;
      totalCo2 += co2Kg;
    }

    return {
      bucket: opts.bucket,
      from: opts.from,
      to: opts.to,
      rows,
      display: {
        totalKwh: formatItKwh(totalKwh),
        totalCost: formatItEur(totalCost),
        totalCo2: formatItKgCO2(totalCo2),
      },
    };
  }

  /**
   * Reconciliation widget data (ENRG-06):
   *
   *   meterKwh   = sum(kwh_delta) from energy_1d rows in [from, to)
   *   cycleKwh   = sum(energy_kwh) from cycle_records WHERE
   *                  attribution_status = 'ATTRIBUTED'
   *                  AND started_at in [from, to)
   *   unknownKwh = sum(energy_kwh) from cycle_records WHERE
   *                  attribution_status IN (UNKNOWN, ABORTED, TOO_SHORT, DATA_GAP)
   *                  AND started_at in [from, to)
   *   idleKwh    = max(0, meterKwh - cycleKwh - unknownKwh)
   *   ratio      = (cycleKwh + idleKwh) / meterKwh   — target >= 0.98
   *
   * If meterKwh is 0 the ratio is returned as 0 (not NaN / Infinity) —
   * Phase 21 renders a 'no data' placeholder.
   *
   * Note: Plan 19-06 will populate cycle_records via startCyclePersister.
   * Until that plan lands, cycleKwh and unknownKwh are 0 for any window,
   * and ratio is always exactly 1.0 (meterKwh becomes entirely idleKwh).
   * That is the expected Plan 19-10 reconciliation behavior — the test
   * fixture for the getReconciliation test validates this "no cycles
   * yet" baseline.
   */
  static async getReconciliation(opts: {
    from: Date;
    to: Date;
  }): Promise<IReconciliationResult> {
    const meterRows = await db.execute(sql`
      SELECT COALESCE(sum(kwh_delta), 0)::float8 AS total
      FROM energy_1d
      WHERE bucket_1d >= ${opts.from}::timestamptz
        AND bucket_1d <  ${opts.to}::timestamptz
    `);
    const meterRow = meterRows.rows[0] as { total: number | string } | undefined;
    const meterKwh = Number(meterRow?.total ?? 0);

    const cycleRows = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN attribution_status = 'ATTRIBUTED'
                          THEN energy_kwh ELSE 0 END), 0)::float8
          AS attributed_kwh,
        COALESCE(SUM(CASE WHEN attribution_status IN ('UNKNOWN','ABORTED','TOO_SHORT','DATA_GAP')
                          THEN energy_kwh ELSE 0 END), 0)::float8
          AS unknown_kwh
      FROM cycle_records
      WHERE started_at >= ${opts.from}::timestamptz
        AND started_at <  ${opts.to}::timestamptz
    `);
    const cycleRow = cycleRows.rows[0] as
      | { attributed_kwh: number | string; unknown_kwh: number | string }
      | undefined;
    const cycleKwh = Number(cycleRow?.attributed_kwh ?? 0);
    const unknownKwh = Number(cycleRow?.unknown_kwh ?? 0);

    const idleKwh = Math.max(0, meterKwh - cycleKwh - unknownKwh);
    const ratio = meterKwh > 0 ? (cycleKwh + idleKwh) / meterKwh : 0;

    return { meterKwh, cycleKwh, idleKwh, unknownKwh, ratio };
  }

  /**
   * Rolling p10 idle baseload in kW over [from, to) (ENRG-07 / CONTEXT
   * D-18).
   *
   * Formula: percentile_cont(0.10) of
   *   (rms_l1_avg + rms_l2_avg + rms_l3_avg) * sqrt(3) * 400V * cosphi
   * sampled from energy_5min. cosphi is read from energy_config at query
   * time (override-able by SUPER_ADMIN via Phase 23 /settings/energy).
   *
   * p10 because the lower decile filters out cycle-active samples,
   * leaving the always-on baseline. 10% is a conservative standard
   * default for industrial drying/shredding loads where cycle phases
   * dominate the upper distribution.
   *
   * Returns kw: null when the window contains no sampled rows (all
   * rms_l1_avg IS NULL — never happens on a live PLC but can happen on
   * empty test windows).
   */
  static async computeIdleBaseload(opts: {
    from: Date;
    to: Date;
  }): Promise<IIdleBaseloadResult> {
    const config = await EnergyConfigService.getConfig();
    const cosphi = Number(config.cosphi);

    const rows = await db.execute(sql`
      SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY
        (
          (
            COALESCE(CASE WHEN rms_l1_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN rms_l1_avg END, 0) +
            COALESCE(CASE WHEN rms_l2_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN rms_l2_avg END, 0) +
            COALESCE(CASE WHEN rms_l3_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN rms_l3_avg END, 0)
          ) / (
            (CASE WHEN rms_l1_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN 1 ELSE 0 END) +
            (CASE WHEN rms_l2_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN 1 ELSE 0 END) +
            (CASE WHEN rms_l3_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN 1 ELSE 0 END)
          )
        ) * sqrt(3) * 400 * ${cosphi} / 1000.0
      )::float8 AS p10_kw
      FROM energy_5min
      WHERE bucket >= ${opts.from}::timestamptz
        AND bucket <  ${opts.to}::timestamptz
        AND (
          (CASE WHEN rms_l1_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN 1 ELSE 0 END) +
          (CASE WHEN rms_l2_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN 1 ELSE 0 END) +
          (CASE WHEN rms_l3_avg BETWEEN ${MIN_VALID_RMS_CURRENT_A} AND ${MAX_VALID_RMS_CURRENT_A} THEN 1 ELSE 0 END)
        ) >= ${MIN_VALID_PHASE_COUNT}
    `);
    const row = rows.rows[0] as { p10_kw: number | string | null } | undefined;
    const p10 = row?.p10_kw;
    const kw = p10 == null ? null : Number(p10);
    return {
      kw: kw != null && Number.isFinite(kw) ? kw : null,
      cosphi,
      windowFrom: opts.from,
      windowTo: opts.to,
    };
  }
}
