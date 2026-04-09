/**
 * EnergyBaselineService — Phase 20 ISO 50001 EnB + Savings math.
 *
 * Schema (ensureSchema), append-only lockBaseline (ENBL-02), evidence freeze
 * (ENBL-06), hard-reject + soft-warning savings math (ENBL-03/04/05/D-11),
 * boot data-availability validator (ENBL-07). Row mappers + read-only
 * freezeBaselineEvidence helper live in `energyBaselineMath.ts` to keep this
 * file under the 500-line CLAUDE.md cap.
 *
 * @see .planning/phases/20-energy-baseline-savings/20-CONTEXT.md D-01..D-12
 * @see .planning/phases/20-energy-baseline-savings/20-RESEARCH.md
 */

import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import {
  freezeBaselineEvidence,
  mapRowToBaseline,
  mapRowToEvidence,
} from './energyBaselineMath.js';
import type {
  BaselineWarning,
  IBaselineLockRequest,
  IBaselineLockResponse,
  IEnergyBaseline,
  ISavingsResponse,
  ISavingsDetailResponse,
} from '@wpt/types';

// =============================================================================
// Error class taxonomy — flat siblings extending Error, matching Phase 19 flatness.
// The route handler catches these with `instanceof` and maps to HTTP 422
// (or 404 for NoActiveBaselineError with explicit baseline_id — RESEARCH Q1).
// =============================================================================

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

// =============================================================================
// Pure-math helper stubs — Plan 02 implements bodies.
// Exported with `_` prefix for unit test access (convention from RESEARCH.md §386).
// =============================================================================

export interface IScalarsInput {
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

export interface IValidationInput {
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
  const measurementMs = input.measurementTo.getTime() - input.measurementFrom.getTime();
  const sevenDaysMs = 7 * 86_400_000;
  if (measurementMs < sevenDaysMs) {
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
 *  - cycle_count < 20     → LOW_CYCLE_COUNT  (Pitfall 5c — non-representative sample)
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

// =============================================================================
// EnergyBaselineService — static class (no instantiation).
//
// Row mappers (`mapRowToBaseline`, `mapRowToEvidence`) and the read-only
// snapshot builder (`freezeBaselineEvidence`) live in `energyBaselineMath.ts`
// to keep this file under the 500-line CLAUDE.md cap. The only DB writes for
// Phase 20 are the BEGIN/COMMIT/ROLLBACK transaction inside `lockBaseline`
// below, plus the idempotent `retired_at = NOW()` UPDATE in `retireBaseline`.
// =============================================================================

export class EnergyBaselineService {
  /**
   * Idempotent schema creation for `energy_baselines` + `baseline_evidence`.
   * Direct SQL — NOT `drizzle-kit push`. Mirrors `EnergyConfigService.ensureTable()`.
   * Called from `apps/backend/src/index.ts` at boot, after `EnergyConfigService.ensureTable()`.
   */
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
   * Lock a new ISO 50001 EnB (method b, period-fixed baseline). Atomic TX
   * (BEGIN/COMMIT/ROLLBACK on a dedicated pg client) wraps: retire previous
   * active baseline → insert energy_baselines → insert baseline_evidence.
   * Uses `pool.connect()` directly (Drizzle 0.45 transaction API differs
   * from the BEGIN/COMMIT pattern Phase 19 uses).
   *
   * @throws {BaselineTooShortError} window < 14 days, period_from in future,
   *                                 or total_kg === 0
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

  /**
   * Sets `retired_at = NOW()` on the baseline. Idempotent — silent on
   * "not found" or "already retired". The route handler owns the 404 check.
   * No body fields (D-05). No cascade to baseline_evidence (retired baselines
   * remain queryable forever).
   */
  static async retireBaseline(baselineId: number): Promise<void> {
    await db.execute(sql`
      UPDATE energy_baselines
      SET retired_at = NOW()
      WHERE baseline_id = ${baselineId}::bigint
        AND retired_at IS NULL
    `);
  }

  /**
   * Returns the most recent un-retired baseline, or null if none exists.
   * D-04: used by the route handler when `baseline_id` query param is absent.
   * Hits the composite index energy_baselines_active_lookup_idx.
   */
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

  /**
   * Returns the baseline with the given id, or null if not found.
   * Retired baselines remain queryable forever (D-05). Never throws on
   * not-found — the route handler owns the 404.
   */
  static async getBaselineById(baselineId: number): Promise<IEnergyBaseline | null> {
    const result = await db.execute(sql`
      SELECT *
      FROM energy_baselines
      WHERE baseline_id = ${baselineId}::bigint
    `);
    if (result.rows.length === 0) return null;
    return mapRowToBaseline(result.rows[0] as Record<string, unknown>);
  }

  static async computeSavings(_req: {
    baselineId: number;
    measurementFrom: Date;
    measurementTo: Date;
    detail: 0 | 1;
  }): Promise<ISavingsResponse | ISavingsDetailResponse> {
    throw new Error('TODO Plan 02/04 — computeSavings');
  }

  static async validateOldestDataAvailability(_baseline: IEnergyBaseline): Promise<void> {
    throw new Error('TODO Plan 05 — validateOldestDataAvailability');
  }
}
