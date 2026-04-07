/**
 * Phase 19 — Energy Data Foundation type stubs and verification gate.
 *
 * IMPORTANT: every type and constant in this file is consumed by the backend
 * energy services (Plans 04-10) and the simulator energy emission (Plan 11).
 * Changes here ripple through the whole phase — modify with care.
 */

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
   * Optional hint set by cycleTracker FSM (Plan 05) when it observes a cycle
   * window that opened and closed WITHOUT completedCycles having incremented
   * during the window. Per CONTEXT D-13 (reformulated) — see Note blocks in
   * Plans 01, 05, and 07.
   *
   * Plan 07's classifyAttribution() honors this hint AFTER window-quality
   * checks (TOO_SHORT, DATA_GAP) take precedence.
   */
  attributionStatusHint?: 'ABORTED';
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
}

export interface ICycleReset {
  id: number;
  resetEpoch: number;
  observedAt: Date;
  lastCompletedCyclesBefore: number;  // value seen on the snapshot just before the decrease
  newCompletedCyclesAfter: number;    // value seen on the snapshot that triggered the reset
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
// STAGE_ENERGY_PROFILE — 9-element array indexed by PLC_STATUS, mirroring the
// 9-stage taxonomy in apps/simulator/src/state/cycleEngine.ts:10-27. Plan 11
// fills in default kwhPerTick rates and the test-mode override.
//
// RESEARCH.md Pitfall D: CONTEXT D-17 says "3 stages" but the actual PLC FSM
// has 9 stages. The plan honors the 9-stage reality.
// =============================================================================

export interface IStageEnergyEntry {
  /** Stage name, must match PLC_STATUS keys exactly. */
  name: 'LOADING' | 'SHREDDING' | 'HEATING' | 'EVAPORATION' | 'OVERHEATING' | 'HOLDING' | 'COOLING' | 'FINAL_DRYING' | 'DISCHARGE';
  /** kWh added to energyConsumption per simulator tick while this stage is active. */
  kwhPerTick: number;
}

/** Default 9-element profile placeholder — Plan 11 fills with realistic and test-mode rates. */
export type StageEnergyProfile = readonly [
  IStageEnergyEntry, IStageEnergyEntry, IStageEnergyEntry,
  IStageEnergyEntry, IStageEnergyEntry, IStageEnergyEntry,
  IStageEnergyEntry, IStageEnergyEntry, IStageEnergyEntry
];
