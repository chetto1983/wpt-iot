/**
 * EnergyBaselineService — Phase 20 ISO 50001 EnB + Savings math.
 * Schema, lockBaseline, evidence freeze, savings math, boot data-availability
 * validator (ENBL-07). Row mappers + read-only helpers live in
 * `energyBaselineMath.ts` to stay under the 500-line CLAUDE.md cap.
 * @see .planning/phases/20-energy-baseline-savings/20-CONTEXT.md D-01..D-12
 */

import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import {
  _buildMeasurementDailySeries,
  _computeSavingsFromScalars,
  _computeSoftWarnings,
  _fetchEvidenceByBaselineId,
  _sumEnergy1dKwhInWindow,
  _validateSavingsWindows,
  freezeBaselineEvidence,
  mapRowToBaseline,
  mapRowToEvidence,
} from './energyBaselineMath.js';
import { EnergyAttributionService } from './energyAttributionService.js';
import type {
  IBaselineLockRequest,
  IBaselineLockResponse,
  IEnergyBaseline,
  ISavingsResponse,
  ISavingsDetailResponse,
} from '@wpt/types';

// Re-exports for back-compat with Plan 02/03 call sites.
export {
  _computeSavingsFromScalars,
  _computeSoftWarnings,
  _validateSavingsWindows,
  freezeBaselineEvidence,
  mapRowToBaseline,
  mapRowToEvidence,
} from './energyBaselineMath.js';
export type {
  IScalarsInput,
  IValidationInput,
} from './energyBaselineMath.js';

// Error taxonomy — flat Error siblings. Route handler instanceof-maps
// to 422 (validation) / 404 (NoActiveBaselineError).

/** Minimal logger for DI (BLOCKER-03 Option 2). Pino satisfies this via duck typing. */
export interface IServiceLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  fatal(obj: Record<string, unknown>, msg: string): void;
}

const NOOP_LOGGER: IServiceLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
};

export class BaselineOverlapError extends Error {
  readonly code = 'BASELINE_OVERLAP' as const;
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BaselineOverlapError';
    this.details = details;
  }
}

export class MeasurementTooShortError extends Error {
  readonly code = 'MEASUREMENT_TOO_SHORT' as const;
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MeasurementTooShortError';
    this.details = details;
  }
}

export type BaselineTooShortReason =
  | 'window_too_short'
  | 'period_from_future'
  | 'no_production';

export class BaselineTooShortError extends Error {
  readonly code = 'BASELINE_TOO_SHORT' as const;
  readonly details: { reason: BaselineTooShortReason; [k: string]: unknown };
  constructor(
    message: string,
    details: { reason: BaselineTooShortReason; [k: string]: unknown },
  ) {
    super(message);
    this.name = 'BaselineTooShortError';
    this.details = details;
  }
}

export class BaselinePredatesDataError extends Error {
  readonly code = 'BASELINE_PREDATES_DATA' as const;
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BaselinePredatesDataError';
    this.details = details;
  }
}

export class NoActiveBaselineError extends Error {
  readonly code = 'NO_ACTIVE_BASELINE' as const;
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'NoActiveBaselineError';
    this.details = details;
  }
}

// Pure-math helpers live in energyBaselineMath.ts (500-line cap split).
// Error classes stay here; math imports them via a circular value import
// (ESM-safe — references are inside function bodies). Re-exports at top.

export class EnergyBaselineService {
  /** Idempotent schema creation. Direct SQL — NOT drizzle-kit push. */
  static async ensureSchema(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS energy_baselines (
        baseline_id             BIGSERIAL PRIMARY KEY,
        label                   TEXT NOT NULL,
        period_from             TIMESTAMPTZ NOT NULL,
        period_to               TIMESTAMPTZ NOT NULL,
        locked_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        retired_at              TIMESTAMPTZ NULL,
        justification           TEXT,
        normalization_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by              TEXT
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS energy_baselines_active_lookup_idx
        ON energy_baselines (retired_at, locked_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS energy_baselines_period_from_idx
        ON energy_baselines (period_from)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS baseline_evidence (
        baseline_id  BIGINT UNIQUE NOT NULL
                     REFERENCES energy_baselines(baseline_id) ON DELETE RESTRICT,
        total_kwh    REAL NOT NULL,
        total_kg     REAL NOT NULL,
        total_cycles INTEGER NOT NULL,
        enpi         REAL NOT NULL,
        total_eur    REAL NOT NULL,
        total_kgco2  REAL NOT NULL,
        daily_series JSONB NOT NULL,
        locked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS baseline_evidence_baseline_id_idx
        ON baseline_evidence (baseline_id)
    `);
  }

  /**
   * Lock a new ISO 50001 EnB (method b). Atomic BEGIN/COMMIT/ROLLBACK TX:
   * retire previous active → insert energy_baselines → insert baseline_evidence.
   * @throws {BaselineTooShortError} window<14d, period_from in future, or total_kg===0
   */
  static async lockBaseline(req: IBaselineLockRequest): Promise<IBaselineLockResponse> {
    // ---- Step 1: validate window ----
    const windowMs = req.periodTo.getTime() - req.periodFrom.getTime();
    const fourteenDaysMs = 14 * 86_400_000;
    if (windowMs < fourteenDaysMs) {
      throw new BaselineTooShortError(
        'Baseline window must be at least 14 days',
        {
          reason: 'window_too_short',
          periodFrom: req.periodFrom.toISOString(),
          periodTo: req.periodTo.toISOString(),
          daysRequired: 14,
          daysProvided: windowMs / 86_400_000,
        },
      );
    }
    if (req.periodFrom.getTime() > Date.now()) {
      throw new BaselineTooShortError(
        'Baseline period_from cannot be in the future',
        {
          reason: 'period_from_future',
          periodFrom: req.periodFrom.toISOString(),
        },
      );
    }

    // ---- Step 2: freeze evidence (read-only — happens BEFORE the TX) ----
    const frozen = await freezeBaselineEvidence(req.periodFrom, req.periodTo);

    // ---- Step 3: enforce total_kg > 0 ----
    if (frozen.totalKg <= 0) {
      throw new BaselineTooShortError(
        'No attributed production in baseline window — baseline is not representative',
        {
          reason: 'no_production',
          periodFrom: req.periodFrom.toISOString(),
          periodTo: req.periodTo.toISOString(),
          totalKg: frozen.totalKg,
          totalCycles: frozen.totalCycles,
        },
      );
    }

    // ---- Step 4: EnPI + soft warnings ----
    const enpi = frozen.totalKwh / frozen.totalKg;
    const warnings = _computeSoftWarnings({
      cycleCount: frozen.totalCycles,
      dataGapRatio: frozen.dataGapRatio,
    });

    // ---- Step 5: atomic transaction (BEGIN/COMMIT/ROLLBACK) ----
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Retire any previously active baseline (idempotent — no-op if none)
      await client.query(
        `UPDATE energy_baselines
            SET retired_at = NOW()
          WHERE retired_at IS NULL`,
      );

      // Insert new baseline row
      const insertBaselineResult = await client.query(
        `INSERT INTO energy_baselines
           (label, period_from, period_to, locked_at, justification,
            normalization_variables, created_by)
         VALUES ($1, $2, $3, NOW(), $4, $5::jsonb, NULL)
         RETURNING baseline_id, label, period_from, period_to, locked_at,
                   retired_at, justification, normalization_variables, created_by`,
        [
          req.label,
          req.periodFrom.toISOString(),
          req.periodTo.toISOString(),
          req.justification ?? null,
          JSON.stringify(req.normalizationVariables ?? {}),
        ],
      );
      const baselineRow = insertBaselineResult.rows[0] as Record<string, unknown>;
      const baselineId = Number(baselineRow.baseline_id);

      // Insert baseline_evidence row
      const insertEvidenceResult = await client.query(
        `INSERT INTO baseline_evidence
           (baseline_id, total_kwh, total_kg, total_cycles, enpi, total_eur,
            total_kgco2, daily_series, locked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
         RETURNING baseline_id, total_kwh, total_kg, total_cycles, enpi,
                   total_eur, total_kgco2, daily_series, locked_at`,
        [
          baselineId,
          frozen.totalKwh,
          frozen.totalKg,
          frozen.totalCycles,
          enpi,
          frozen.totalEur,
          frozen.totalKgco2,
          JSON.stringify(frozen.dailySeries),
        ],
      );
      const evidenceRow = insertEvidenceResult.rows[0] as Record<string, unknown>;

      await client.query('COMMIT');

      return {
        baseline: mapRowToBaseline(baselineRow),
        evidence: mapRowToEvidence(evidenceRow),
        warnings,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Idempotent `retired_at = NOW()` UPDATE. Route handler owns the 404 check. */
  static async retireBaseline(baselineId: number): Promise<void> {
    await db.execute(sql`
      UPDATE energy_baselines
      SET retired_at = NOW()
      WHERE baseline_id = ${baselineId}::bigint
        AND retired_at IS NULL
    `);
  }

  /** Most recent un-retired baseline or null. Hits active_lookup composite idx. */
  static async getActiveBaseline(): Promise<IEnergyBaseline | null> {
    const result = await db.execute(sql`
      SELECT *
      FROM energy_baselines
      WHERE retired_at IS NULL
      ORDER BY locked_at DESC
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    return mapRowToBaseline(result.rows[0] as Record<string, unknown>);
  }

  /** Baseline by id or null. Retired baselines remain queryable (D-05). */
  static async getBaselineById(baselineId: number): Promise<IEnergyBaseline | null> {
    const result = await db.execute(sql`
      SELECT *
      FROM energy_baselines
      WHERE baseline_id = ${baselineId}::bigint
    `);
    if (result.rows.length === 0) return null;
    return mapRowToBaseline(result.rows[0] as Record<string, unknown>);
  }

  /**
   * Compute savings against a frozen baseline (D-09). Flow: fetch baseline+
   * evidence → ENBL-07 belt check → validate windows → query measurement →
   * zero-kg guard → pure math → optional detail=1 dailySeries.
   * @throws {NoActiveBaselineError | BaselineOverlapError | MeasurementTooShortError | BaselinePredatesDataError}
   */
  static async computeSavings(req: {
    baselineId: number;
    measurementFrom: Date;
    measurementTo: Date;
    detail: 0 | 1;
  }): Promise<ISavingsResponse | ISavingsDetailResponse> {
    // ---- Step 1: fetch baseline + evidence ----
    const baseline = await EnergyBaselineService.getBaselineById(req.baselineId);
    if (!baseline) {
      throw new NoActiveBaselineError(
        `No baseline with id ${req.baselineId}`,
        { baselineId: req.baselineId },
      );
    }
    const evidence = await _fetchEvidenceByBaselineId(req.baselineId);
    if (!evidence) {
      // FK guarantees this never happens — but throw a deterministic error
      // instead of a null-dereference if partial state somehow escapes.
      throw new NoActiveBaselineError(
        `Baseline ${req.baselineId} has no evidence row — data integrity failure`,
        { baselineId: req.baselineId },
      );
    }

    // ENBL-07 per-request belt. assertNotStale hard-codes NOOP_LOGGER
    // (WR-04: no .fatal() spam on every savings request).
    await EnergyBaselineService.assertNotStale(baseline);

    // ---- Step 2: validate windows ----
    _validateSavingsWindows({
      baselinePeriodTo: baseline.periodTo,
      measurementFrom: req.measurementFrom,
      measurementTo: req.measurementTo,
    });

    // ---- Step 3: query measurement scalars ----
    const measurementTotalKwh = await _sumEnergy1dKwhInWindow(
      req.measurementFrom,
      req.measurementTo,
    );
    const { totalKg: measurementTotalKg } =
      await EnergyAttributionService.sumAttributedKgInWindow({
        from: req.measurementFrom,
        to: req.measurementTo,
      });

    // ---- Step 4: belt-and-suspenders zero-kg guard ----
    if (measurementTotalKg === 0) {
      throw new MeasurementTooShortError(
        'No attributed production in measurement window',
        {
          measurementFrom: req.measurementFrom.toISOString(),
          measurementTo: req.measurementTo.toISOString(),
          measurementTotalKwh,
        },
      );
    }

    // ---- Step 5: pure math (frozen lock-time tariff & CO2 factor) ----
    const baselineEurPerKwh =
      evidence.totalKwh > 0 ? evidence.totalEur / evidence.totalKwh : 0;
    const baselineKgCO2PerKwh =
      evidence.totalKwh > 0 ? evidence.totalKgco2 / evidence.totalKwh : 0;
    const scalarResult = _computeSavingsFromScalars({
      baseline: {
        enpi: evidence.enpi,
        totalKwh: evidence.totalKwh,
        totalKg: evidence.totalKg,
        normalizationVariables: baseline.normalizationVariables,
        periodFrom: baseline.periodFrom,
        periodTo: baseline.periodTo,
        baselineId: baseline.baselineId,
        label: baseline.label,
      },
      measurement: {
        totalKwh: measurementTotalKwh,
        totalKg: measurementTotalKg,
      },
      baselineEurPerKwh,
      baselineKgCO2PerKwh,
      windowFrom: req.measurementFrom,
      windowTo: req.measurementTo,
    });

    // ---- Step 6: attach detail=1 dailySeries if requested ----
    if (req.detail === 1) {
      const dailySeries = await _buildMeasurementDailySeries(
        req.measurementFrom,
        req.measurementTo,
        evidence.enpi,
      );
      return { ...scalarResult, dailySeries };
    }
    return scalarResult;
  }

  /** WR-04: per-request belt. Hard-codes NOOP_LOGGER so computeSavings cannot page on-call. */
  static async assertNotStale(baseline: IEnergyBaseline): Promise<void> {
    return EnergyBaselineService.validateOldestDataAvailability(baseline, NOOP_LOGGER);
  }

  /**
   * ENBL-07 gate. If MIN(bucket_1d) > baseline.periodFrom, retention has
   * eaten the backing data — log fatal + throw. `log` is DI for test capture
   * (BLOCKER-03 Option 2). Per-request callers use assertNotStale (WR-04).
   * @throws {BaselinePredatesDataError}
   */
  static async validateOldestDataAvailability(
    baseline: IEnergyBaseline,
    log: IServiceLogger = NOOP_LOGGER,
  ): Promise<void> {
    const result = await db.execute(sql`
      SELECT MIN(bucket_1d) AS oldest_bucket
      FROM energy_1d
    `);
    const row = result.rows[0] as { oldest_bucket: string | Date | null } | undefined;
    if (!row || row.oldest_bucket == null) {
      // WR-06: empty energy_1d + baseline passed in = catastrophic purge.
      // Callers only reach this function AFTER resolving a concrete baseline
      // (onReady early-returns on null; assertNotStale runs post-getBaselineById).
      // "Everything predates the oldest bucket" when no bucket exists — fire
      // the gate. Earlier silent-return path conflated first-boot with purge.
      log.fatal(
        {
          name: 'EnergyBaseline',
          baselineId: baseline.baselineId,
          oldestBucket: null,
          baselinePeriodFrom: baseline.periodFrom.toISOString(),
        },
        'baseline_predates_available_data',
      );
      throw new BaselinePredatesDataError(
        'Active baseline exists but energy_1d is empty — retention or CAGG refresh has wiped the backing data',
        {
          baselineId: baseline.baselineId,
          oldestBucket: null,
          baselinePeriodFrom: baseline.periodFrom.toISOString(),
        },
      );
    }
    const oldestBucket = row.oldest_bucket instanceof Date
      ? row.oldest_bucket
      : new Date(row.oldest_bucket);
    if (oldestBucket.getTime() > baseline.periodFrom.getTime()) {
      log.fatal(
        {
          name: 'EnergyBaseline',
          baselineId: baseline.baselineId,
          oldestBucket: oldestBucket.toISOString(),
          baselinePeriodFrom: baseline.periodFrom.toISOString(),
        },
        'baseline_predates_available_data',
      );
      throw new BaselinePredatesDataError(
        'Active baseline period_from predates the oldest available energy_1d bucket',
        {
          baselineId: baseline.baselineId,
          oldestBucket: oldestBucket.toISOString(),
          baselinePeriodFrom: baseline.periodFrom.toISOString(),
        },
      );
    }
  }
}
