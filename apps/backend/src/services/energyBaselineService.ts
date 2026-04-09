/**
 * EnergyBaselineService
 *
 * Phase 20 — ISO 50001-compatible Energy Baseline (EnB) + Savings math.
 *
 * Responsibilities:
 *   - Create `energy_baselines` + `baseline_evidence` tables via direct-SQL
 *     `ensureSchema()` (mirroring `EnergyConfigService.ensureTable()`).
 *   - Lock a baseline (append-only, no UPDATE endpoint — ENBL-02).
 *   - Freeze a `baseline_evidence` snapshot at lock time (ENBL-06).
 *   - Compute savings with hard-reject validation + soft warnings (ENBL-03, D-11).
 *   - Validate baseline data preservation on boot + per-request (ENBL-07).
 *
 * File size cap: 500 lines (CLAUDE.md).
 *
 * @see .planning/phases/20-energy-baseline-savings/20-CONTEXT.md D-01 through D-12
 * @see .planning/phases/20-energy-baseline-savings/20-RESEARCH.md
 * @see REQUIREMENTS.md §ENBL (ENBL-01 through ENBL-07)
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type {
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

export function _computeSoftWarnings(_input: {
  cycleCount: number;
  dataGapRatio: number;
}): Array<'LOW_CYCLE_COUNT' | 'HIGH_DATA_GAP_RATIO'> {
  throw new Error('TODO Plan 03 — _computeSoftWarnings');
}

// =============================================================================
// EnergyBaselineService — static class (no instantiation).
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

  static async lockBaseline(_req: IBaselineLockRequest): Promise<IBaselineLockResponse> {
    throw new Error('TODO Plan 03 — lockBaseline');
  }

  static async retireBaseline(_baselineId: number): Promise<void> {
    throw new Error('TODO Plan 03 — retireBaseline');
  }

  static async getActiveBaseline(): Promise<IEnergyBaseline | null> {
    throw new Error('TODO Plan 03 — getActiveBaseline');
  }

  static async getBaselineById(_baselineId: number): Promise<IEnergyBaseline | null> {
    throw new Error('TODO Plan 03 — getBaselineById');
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
