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

export function _validateSavingsWindows(_input: IValidationInput): void {
  throw new Error('TODO Plan 02 — _validateSavingsWindows');
}

export function _computeSavingsFromScalars(_input: IScalarsInput): ISavingsResponse {
  throw new Error('TODO Plan 02 — _computeSavingsFromScalars');
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
