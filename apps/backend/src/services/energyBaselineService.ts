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

// Re-export math helpers for back-compat — older Plan 02/03 tests / imports
// reference these names from `energyBaselineService.js`. New code should
// import directly from `energyBaselineMath.js`.
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
// Pure-math helpers — moved to `energyBaselineMath.ts` (Plan 04 cap-driven
// extension of the WARNING 5 split). The error classes above stay here so the
// route mapper can `instanceof`-check them; the math module imports those
// classes via a circular import, which is ESM-safe because the references
// are inside function bodies (not module-top-level). Re-exports for back-compat
// live at the top of this file alongside the value imports.
// =============================================================================

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

  /**
   * Compute savings for a measurement window against a frozen baseline (D-09).
   *
   * Flow:
   *  1. Fetch baseline + evidence (404 if baseline missing)
   *  2. Validate windows (422 on overlap / too-short measurement)
   *  3. Query measurement totals (energy_1d kWh + ATTRIBUTED cycle_records kg)
   *  4. Belt-and-suspenders zero-kg guard
   *  5. Compute pure math via _computeSavingsFromScalars
   *  6. Optionally attach detail=1 dailySeries
   *
   * NOTE: ENBL-07 `validateOldestDataAvailability` is NOT called here. Plan 05
   * wires it in via the startup onReady hook + an internal pre-computeSavings
   * call. Plan 04 ships without that check.
   *
   * @throws {NoActiveBaselineError} when baseline_id is not found
   * @throws {BaselineOverlapError | MeasurementTooShortError} on window violations
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

  static async validateOldestDataAvailability(_baseline: IEnergyBaseline): Promise<void> {
    throw new Error('TODO Plan 05 — validateOldestDataAvailability');
  }
}
