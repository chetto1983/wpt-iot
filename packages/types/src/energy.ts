/**
 * Phase 19 — Energy Data Foundation type stubs and verification gate.
 *
 * IMPORTANT: every type and constant in this file is consumed by the backend
 * energy services (Plans 04-10) and the simulator energy emission (Plan 11).
 * Changes here ripple through the whole phase — modify with care.
 */

import { z } from 'zod/v4';

// =============================================================================
// ENERGY_VERIFICATION_GATE — pin Q1-Q7 from PITFALLS.md §Open Questions.
// Per CONTEXT D-01/D-02, the simulator-derived hypothesis is TENTATIVE pending
// the bench-day verification gate. DO NOT REMOVE this block until the bench day
// has run and a SUPER_ADMIN has signed off (see 19-01-SUMMARY.md).
// =============================================================================
/*
ENERGY_VERIFICATION_GATE — answers as of 2026-04-07 (Phase 19 Plan 01 spike)

Q1. What is `energy_consumption` semantically?
    ANSWERED-TENTATIVE: lifetime kWh totalizer in a 32-bit REAL field.
    Source: simulator cycleEngine.ts:302-304 increments cumulatively
    (`current.energyConsumption + energyIncrement`); never decrements inside
    cycleEngine. Real PLC behavior NOT verified — bench day required.

Q2. Does the totalizer ever reset?
    ANSWERED-TENTATIVE-EMPIRICAL: YES — observed in dev DB on 2026-04-04 10:57
    and 2026-04-05 15:00 due to simulator state-file wipes (container restart).
    The reset is external to cycleEngine (state file reinit via
    createDefaultMachineData). Real-PLC analogue is PLC reboot. Reset detection
    is therefore NOT theoretical insurance — `cycle_resets` table fires in
    practice. Bench day must confirm whether PLC reboot is the only real-world
    reset trigger.

Q3. What is the totalizer unit?
    ANSWERED-TENTATIVE: kWh (researcher's nomenclature; the PLC field carries
    no unit metadata). 0-15 per-tick range over 15s ticks is consistent with
    kWh-scale industrial drying load. Bench day must read the Mappatura Excel
    or query the WPT machine engineer for the documented unit.

Q4. Does machine_snapshots.timestamp resolve to TIMESTAMPTZ?
    ANSWERED — DEFINITIVE. Two sources:
      (a) wpt-iot/apps/backend/src/db/schema/machine.ts:5 declares
          `timestamp('timestamp', { withTimezone: true })`.
      (b) Live DB query (2026-04-07) of information_schema.columns reports
          `data_type='timestamp with time zone', udt_name='timestamptz'`.
    No further action required. All energy aggregates may safely use
    `time_bucket(..., 'Europe/Rome')` for DST-correct bucketing.

Q5. cosφ for ENRG-07 idle baseload formula?
    ANSWERED: 0.85 (industrial standard for resistive-dominant heating loads).
    Hardcoded as the constant DEFAULT_COSPHI below; also written as the default
    of the `cosphi REAL` column on the `energy_config` singleton table so
    SUPER_ADMIN can override it from /settings/energy in Phase 23 without a
    code change. (CONTEXT D-04.)

Q6. Customer tariff mode — single-rate or F1/F2/F3?
    ANSWERED with seed: single-rate, 0.25 €/kWh, ISPRA emission factor
    0.279 kgCO2/kWh, valid_from = 2024-01-01. The 3-band F1/F2/F3 schema and
    classifyTariffBand() pure function ship in Phase 19 anyway (Plan 04, 02);
    Phase 23 SUPER_ADMIN form toggles between modes. (CONTEXT D-05.)

Q7. ISO 50001 PDF template preference?
    OUT-OF-SCOPE for Phase 19 — owned by Phase 22 design.

BENCH-DAY EXIT GATE (CONTEXT D-02 — non-negotiable):
    Before any v1.1 customer ship, bench day MUST verify against the real
    ABB AC500 PLC: (a) energy_consumption is a lifetime kWh totalizer,
    (b) it never resets except on PLC reboot, (c) the unit is kWh
    (not Wh or MWh). Bench day must ALSO verify the D-13 reformulation
    assumption (see Note block in Plan 01): that currentPhase transitions
    STANDBY → AUTOMATIC_STARTED → STANDBY accurately bracket a cycle on
    the real PLC. If any assumption fails, all energy aggregates require
    rework. This is non-negotiable because of project constraint C-01 (real
    PLC firmware is fixed and cannot be modified).
*/

/** Default power factor for ENRG-07 idle baseload formula. Override via energy_config.cosphi. */
export const DEFAULT_COSPHI = 0.85;

/** Default ISPRA grid emission factor seed (kgCO2 per kWh). Override via energy_config_periods.emission_factor_kg_per_kwh. */
export const DEFAULT_EMISSION_FACTOR_KG_PER_KWH = 0.279;

/** Default single-rate tariff seed (€ per kWh). Override via energy_config_periods.tariff_single_eur_per_kwh. */
export const DEFAULT_TARIFF_SINGLE_EUR_PER_KWH = 0.25;

/** Default first-row valid_from for the seed energy_config_periods row (CONTEXT D-05). */
export const DEFAULT_TARIFF_VALID_FROM_ISO = '2024-01-01T00:00:00Z';

// =============================================================================
// AttributionStatus — per CONTEXT D-13 (as reformulated — see Plan 01/05/07 Note blocks).
// Used by cycle_records.attribution_status.
// =============================================================================

export enum AttributionStatus {
  /** Happy path: window had >=5 samples, no >60s gap, no reset, completedCycles incremented. */
  ATTRIBUTED = 'ATTRIBUTED',
  /**
   * Cycle window opened+closed without a completedCycles increment.
   * Detection: cycleTracker FSM (Plan 05) sets attributionStatusHint on the
   * emitted ICycleClosedEvent; classifyAttribution (Plan 07) honors the hint
   * after TOO_SHORT/DATA_GAP precedence checks.
   * NOTE: there is NO MachineStatus.ABORTED enum value — see Plan 01/05/07 Note blocks.
   */
  ABORTED = 'ABORTED',
  /** Window covers fewer than 5 snapshots (75 seconds at 15s sampling) — too short to attribute reliably. */
  TOO_SHORT = 'TOO_SHORT',
  /** Window overlaps a >60s gap in machine_snapshots (ENRG-05 threshold). */
  DATA_GAP = 'DATA_GAP',
  /** Catch-all for cases that fall through (logged as warnings; includes negative kwh_delta from reset-in-window — per-bucket split deferred to v1.2 per Plan 12 KNOWN_ISSUES). */
  UNKNOWN = 'UNKNOWN',
}

// =============================================================================
// Cycle event payload — emitted by dataHub.emitCycleClosed (Plan 05).
// =============================================================================

export interface ICycleClosedEvent {
  cycleNumber: number;       // PLC completedCycles value at closure (or cycleStartCompletedCycles+1 if aborted)
  resetEpoch: number;        // counter-reset epoch (incremented each time completedCycles decreases)
  startedAt: Date;
  endedAt: Date;
  cycleType: number;         // raw selectedCycle value from snapshot
  machineStatus: number;     // raw machineStatus value at endedAt
  /**
   * V03 Cycle_Status decoded label: OK, FAILED, ABORTED.
   * Set by cycleTracker from S1_I_DATO_71 rising-edge detection.
   * Supersedes attributionStatusHint for the cycle register.
   */
  cycleStatusLabel: string;
  /** Absolute energy meter reading at cycle start (S1_R_DATO_1 snapshot) */
  startEnergyKwh: number | null;
  /** Absolute energy meter reading at cycle end (S1_R_DATO_1 snapshot) */
  endEnergyKwh: number | null;
  /** Absolute water meter reading at cycle start (S1_R_DATO_14 snapshot) */
  startWaterL: number | null;
  /** Absolute water meter reading at cycle end (S1_R_DATO_14 snapshot) */
  endWaterL: number | null;
  /** Computed energy delta (end - start) in kWh */
  energyKwh: number | null;
  /** Computed water delta (end - start) in liters */
  waterL: number | null;
  /** Bidoni count (S1_I_DATO_72, V03 Container) - plural alias for ICycleClosedEvent */
  containers: number | null;
  /** RFID user name (S1_S_DATO_1) */
  operator: string | null;
  /** Order number (S1_S_DATO_3) */
  orderNumber: string | null;
  /** Gross input weight including infectious waste (S1_I_DATO_57, mapped from materialInputWeight) */
  grossInputKg: number | null;
  /** Material input weight alias */
  materialInputKg: number | null;
  /**
   * Optional hint set by cycleTracker when it observes a cycle
   * window that opened and closed WITHOUT completedCycles having incremented
   * during the window. Kept for backward compat with classifyAttribution().
   */
  attributionStatusHint?: 'ABORTED';
  /** Flag set when cycle start was skipped (data gap) */
  dataGap?: boolean;
}

/** Cycle start event payload — emitted by dataHub.emitCycleStart (Phase 24) */
export interface ICycleStartEvent {
  cycleNumber: number;
  /** Absolute energy meter reading at cycle start (S1_R_DATO_1 snapshot) */
  startEnergyKwh: number | null;
  /** Absolute water meter reading at cycle start (S1_R_DATO_14 snapshot) */
  startWaterL: number | null;
  /** RFID user name (S1_S_DATO_1) */
  operator: string;
  /** Order number (S1_S_DATO_3) */
  orderNumber: string;
  /** Bidoni count (S1_I_DATO_72, V03 Container) */
  containers: number;
  /** Cycle start timestamp */
  startedAt: Date;
}

// =============================================================================
// Persistent record interfaces — mirror the Drizzle/SQL columns created in
// Plan 04 ensureTable() / ensureSchema(). Type inference only — never used
// for db:push.
// =============================================================================

export interface IEnergyConfig {
  id: number;
  customerName: string;
  machineSerial: string;
  machineModel: string;
  installSite: string;
  cosphi: number;            // Q5 default 0.85
  shiftStartHour: number;
  updatedAt: Date;
}

export interface IEnergyConfigPeriod {
  id: number;
  validFrom: Date;
  validTo: Date | null;      // null = open-ended (current period)
  emissionFactorKgPerKwh: number;
  emissionFactorYear: number;
  emissionFactorSource: string;
  tariffMode: 'single' | 'tou3';
  tariffSingleEurPerKwh: number;
  tariffBandsJson: ITariffBands;
  customHolidays: string[];  // ISO date strings, customer shutdown days (ECFG-06)
  createdAt: Date;
}

export interface ITariffBands {
  f1?: { eurPerKwh: number };
  f2?: { eurPerKwh: number };
  f3?: { eurPerKwh: number };
}

export const ENERGY_TARIFF_BAND_KEYS = ['f1', 'f2', 'f3'] as const;
export type EnergyTariffBandKey = (typeof ENERGY_TARIFF_BAND_KEYS)[number];

const EnergyTariffModeSchema = z.enum(['single', 'tou3']);

const EnergyTariffBandValueSchema = z.object({
  eurPerKwh: z.number().min(0.001).max(2.0),
});

const EnergyTariffBandsSchema = z.object({
  f1: EnergyTariffBandValueSchema.optional(),
  f2: EnergyTariffBandValueSchema.optional(),
  f3: EnergyTariffBandValueSchema.optional(),
});

export const EnergyConfigUpdateSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  machineSerial: z.string().trim().min(1).max(100),
  machineModel: z.string().trim().min(1).max(100),
  installSite: z.string().trim().min(1).max(200),
  cosphi: z.number().min(0).max(1),
  shiftStartHour: z.number().int().min(0).max(23),
  effectiveFrom: z.string().datetime(),
  emissionFactorKgPerKwh: z.number().min(0.05).max(2.0),
  emissionFactorYear: z.number().int().min(2000).max(9999),
  emissionFactorSource: z.string().trim().min(1).max(200),
  tariffMode: EnergyTariffModeSchema,
  tariffSingleEurPerKwh: z.number().min(0.001).max(2.0),
  tariffBandsJson: EnergyTariffBandsSchema,
});

export interface IEnergyConfigUpdateRequest
  extends z.infer<typeof EnergyConfigUpdateSchema> {}

export interface IEnergyAdminConfigResponse {
  config: IEnergyConfig;
  activePeriod: IEnergyConfigPeriod;
}

export interface ICycleRecord {
  cycleNumber: number;
  resetEpoch: number;        // composite cycle ID (resetEpoch, cycleNumber) per ENRG-04
  startedAt: Date;
  endedAt: Date;
  cycleType: number;
  durationSeconds: number;
  materialInputKg: number | null;
  materialOutputKg: number | null;
  energyKwh: number | null;
  waterL: number | null;
  avgRmsCurrent: number | null;
  kwhPerKg: number | null;   // NULL when material weights are 0 (ENRG-09 — never Infinity)
  attributionStatus: AttributionStatus;
  serialNumber: string | null;
  orderNumber: string | null;
  // Phase 24: V03 cycle register fields (matching Base_registro_mensile_cicli.xls "Elab marzo")
  startEnergyKwh: number | null;
  endEnergyKwh: number | null;
  startWaterL: number | null;
  endWaterL: number | null;
  containers: number | null;
  operator: string | null;
  cycleStatusLabel: string | null;
  grossInputKg: number | null;
}

// =============================================================================
// Aggregate query result interfaces — populated by energyAggregateService (Plan 10).
// =============================================================================

export type EnergyBucket = '5min' | 'hour' | 'day' | 'month';

export interface IEnergyAggregateRow {
  bucket: Date;
  kwhDelta: number;
  costEur: number;           // computed at aggregation time per ECFG-03
  co2Kg: number;             // computed at aggregation time per ECFG-04
  sampleCount: number;
}

export interface IEnergyAggregateResponse {
  bucket: EnergyBucket;
  from: Date;
  to: Date;
  rows: IEnergyAggregateRow[];
  /** Italian-formatted display strings (Plan 10 uses format.ts helpers from Plan 02). */
  display: {
    totalKwh: string;        // formatItKwh
    totalCost: string;       // formatItEur
    totalCo2: string;        // formatItKgCO2
  };
}

// =============================================================================
// Phase 20 — Energy Baseline & Savings
// =============================================================================

/**
 * ISO 50001-compatible energy baseline row.
 * Multi-row, lock-once, append-new, retire-old — no UPDATE endpoint.
 * Active baseline = most recent un-retired row (highest `lockedAt` with `retiredAt IS NULL`).
 *
 * @see .planning/phases/20-energy-baseline-savings/20-CONTEXT.md D-01 through D-05
 * @see REQUIREMENTS.md ENBL-01, ENBL-02
 */
export interface IEnergyBaseline {
  baselineId: number;
  label: string;
  periodFrom: Date;
  periodTo: Date;
  lockedAt: Date;
  retiredAt: Date | null;
  justification: string | null;
  normalizationVariables: Record<string, unknown>;
  createdBy: string | null;
}

/**
 * One entry in the frozen `daily_series` JSONB column on `baseline_evidence`.
 * Europe/Rome local date, ascending order. Cost and CO₂ are frozen at lock time
 * from the `energy_config_periods` row(s) in force that day (D-07).
 */
export interface IBaselineDailyPoint {
  date: string;       // YYYY-MM-DD, Europe/Rome local day
  kwh: number;
  kg: number;
  cyclesCount: number;
  eur: number;
  kgco2: number;
}

/**
 * Frozen baseline evidence snapshot — 1:1 with `energy_baselines` via FK.
 * Survives the 30-day retention on `machine_snapshots` so a baseline stays
 * verifiable after the raw snapshots drop (ENBL-06).
 *
 * `daily_series` serves audit plotting; scalars serve fast dashboard queries.
 * Phase 22 PDF reads the scalars, NEVER re-sums `daily_series` (precision drift).
 */
export interface IBaselineEvidence {
  baselineId: number;
  totalKwh: number;
  totalKg: number;
  totalCycles: number;
  enpi: number;       // total_kwh / total_kg
  totalEur: number;   // frozen at lock time from energy_config_periods
  totalKgco2: number; // frozen at lock time from energy_config_periods
  dailySeries: IBaselineDailyPoint[];
  lockedAt: Date;
}

/**
 * POST /api/energy/baseline/lock request body.
 * Dates arrive as ISO strings on the wire and are coerced to Date in the route handler.
 */
export interface IBaselineLockRequest {
  label: string;
  periodFrom: Date;
  periodTo: Date;
  justification?: string;
  normalizationVariables: Record<string, unknown>;
}

/**
 * Soft quality warnings emitted by `lockBaseline` — non-blocking (D-11).
 * The lock always succeeds; these are advisory flags for the SUPER_ADMIN UI.
 */
export const BaselineWarning = z.enum([
  'LOW_CYCLE_COUNT',      // cycle_count < 20 in baseline window
  'HIGH_DATA_GAP_RATIO',  // data_gap_ratio > 0.05 in baseline window
]);
export type BaselineWarning = z.infer<typeof BaselineWarning>;

/**
 * POST /api/energy/baseline/lock response body (201 Created).
 */
export interface IBaselineLockResponse {
  baseline: IEnergyBaseline;
  evidence: IBaselineEvidence;
  warnings: BaselineWarning[];
}

/**
 * Error code enum — single source of truth for frontend i18n (Phase 21).
 * D-10: 4 codes map to HTTP 422, NO_ACTIVE_BASELINE maps to HTTP 404
 * when baseline_id is explicit (RESEARCH Open Question 1).
 */
export const BaselineErrorCode = z.enum([
  'BASELINE_OVERLAP',
  'MEASUREMENT_TOO_SHORT',
  'BASELINE_TOO_SHORT',
  'BASELINE_PREDATES_DATA',
  'NO_ACTIVE_BASELINE',
]);
export type BaselineErrorCode = z.infer<typeof BaselineErrorCode>;

/**
 * GET /api/energy/savings default response (`detail` absent or `0`).
 * `deltaPct` sign convention: NEGATIVE means better than baseline (consumption down).
 * Frontend renders signed text explicitly per ENBL-05 — never a bare minus sign.
 */
export interface ISavingsResponse {
  baselineId: number;
  baselineLabel: string;
  baselineEnpi: number;      // kWh/kg
  measurementEnpi: number;   // kWh/kg
  deltaPct: number;          // negative = better
  deltaKwh: number;
  deltaEur: number;
  deltaKgco2: number;
  confidence: 'HIGH' | 'LOW';
  windowFrom: string;        // ISO
  windowTo: string;          // ISO
  excludedStatuses: Array<'ABORTED' | 'TOO_SHORT' | 'DATA_GAP' | 'UNKNOWN'>;
}

/**
 * GET /api/energy/savings `detail=1` response. Extends `ISavingsResponse`
 * with a per-day measurement series + a constant baseline reference line
 * (D-09 interpretation, RESEARCH Open Question 3).
 */
export interface ISavingsDetailResponse extends ISavingsResponse {
  dailySeries: Array<{
    date: string;                 // YYYY-MM-DD, Europe/Rome
    baselineKwhPerKg: number;     // constant = baseline.enpi
    measurementKwhPerKg: number;  // per-day measurement EnPI
  }>;
}

/**
 * Zod schema for `POST /api/energy/baseline/lock` request validation.
 * Dates are ISO strings on the wire; the route handler coerces to Date
 * before passing to `EnergyBaselineService.lockBaseline()`.
 */
export const BaselineLockRequestSchema = z.object({
  label: z.string().min(1).max(200),
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
  justification: z.string().optional(),
  normalizationVariables: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Zod schema for `GET /api/energy/savings` query-string validation.
 * `baseline_id` is optional — absence triggers default-baseline resolution (D-04).
 * `detail` is `'0'` or `'1'` (query strings are strings, not numbers).
 */
export const SavingsQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  baseline_id: z.string().optional(),
  detail: z.enum(['0', '1']).optional().default('0'),
});

export const EnergyPdfReportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  lang: z.enum(['it', 'en']).optional().default('it'),
  baseline_id: z.string().optional(),
});

// =============================================================================
// Phase 21 - Energy KPI dashboard UI
// =============================================================================

export const EnergyMetric = z.enum([
  'kwh',
  'eur',
  'kgco2',
]);
export type EnergyMetric = z.infer<typeof EnergyMetric>;

export const EnergyDashboardSummaryQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const EnergyCyclesQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10),
});

export const EnergyReconciliationQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export interface IEnergyDashboardTariffBreakdown {
  f1: number;
  f2: number;
  f3: number;
}

export interface IEnergyDashboardRmsCurrentAvg {
  l1: number | null;
  l2: number | null;
  l3: number | null;
}

export interface IEnergyDashboardWptDetails {
  peakPowerKw: number | null;
  baselineEnpi: number | null;
  tariffBandKwh: IEnergyDashboardTariffBreakdown;
  rmsCurrentAvg: IEnergyDashboardRmsCurrentAvg;
}

export interface IEnergyDashboardSummary {
  currentPowerKw: number | null;
  dayToDateKwh: number;
  dayToDateEur: number;
  dayToDateKgCo2: number;
  cyclesToday: number;
  savings: ISavingsResponse | null;
  savingsUnavailableReason?: BaselineErrorCode | 'UNAVAILABLE' | null;
  wptDetails?: IEnergyDashboardWptDetails;
}

export interface IEnergyCycleRow {
  cycleType: number;
  cycleLabelKey: string;
  cycleLabel: string;
  cycleCount: number;
  totalKwh: number;
  totalKg: number;
  avgKwhPerKg: number | null;
}

export interface IEnergyCyclesResponse {
  from: string;
  to: string;
  limit: number;
  rows: IEnergyCycleRow[];
}

export interface IEnergyReconciliationWptDetails {
  accountedRatio: number;
  idleBaseloadKw: number | null;
}

export interface IEnergyReconciliationResponse {
  meterKwh: number;
  cyclesKwh: number;
  idleKwh: number;
  unknownKwh: number;
  cyclesPct: number;
  idlePct: number;
  unknownPct: number;
  warning: boolean;
  wptDetails?: IEnergyReconciliationWptDetails;
}

export const CLIENT_VISIBLE_ENERGY_FIELDS = [
  'currentPowerKw',
  'dayToDateKwh',
  'dayToDateEur',
  'dayToDateKgCo2',
  'cyclesToday',
  'savings',
  'savingsUnavailableReason',
] as const satisfies ReadonlyArray<keyof IEnergyDashboardSummary>;

export const WPT_VISIBLE_ENERGY_FIELDS = [
  ...CLIENT_VISIBLE_ENERGY_FIELDS,
  'wptDetails',
] as const satisfies ReadonlyArray<keyof IEnergyDashboardSummary>;
