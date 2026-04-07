import {
  CycleType,
  MachinePhase,
  MachineStatus,
  RfidUserGroup,
  RemoteJobEnable,
  MaintenanceRequest,
  RemoteCycleSelection,
} from '@wpt/types';
import type { IMachineSnapshot, IRfidUser, IJobData } from '@wpt/types';

// =============================================================================
// Phase 19 Plan 11 — ESIM-01 per-stage energy emission profile.
//
// Replaces the v1.0 motor-speed-coupled energy increment in cycleEngine.ts
// (line 302-304 at revision time) with a deterministic, physically plausible
// per-stage Specific Energy Consumption (SEC) model. Indexed 0..8 to match the
// PLC_STATUS / STAGE_ORDER taxonomy in cycleEngine.ts:10-27. Per RESEARCH.md
// "Pitfall D": the real PLC FSM has 9 stages, NOT the 3 stages CONTEXT D-17
// casually mentioned — this profile honors the 9-stage reality.
//
// Default rates (tuned to ~10-20 kWh per cycle):
//   - LOADING / DISCHARGE: motor-only mechanical work, low draw
//   - SHREDDING / COOLING / FINAL_DRYING: transitional, moderate
//   - HEATING / EVAPORATION / OVERHEATING / HOLDING: sustained heat, dominant
//
// Monotonicity invariant (ESIM-03): every kwhPerTick MUST be >= 0 so the
// energy totalizer is guaranteed non-decreasing across cycles.
//
// Test-mode override: overrideStageEnergyProfileForTest({ uniformKwhPerTick })
// replaces the active profile with a uniform rate for the duration of a test.
// restoreStageEnergyProfile() restores the default. Used by Plan 12's
// deterministic 1000 → 1015 kWh / 5-minute fixture: setting every stage to
// 0.75 kWh/tick × 20 ticks = exactly 15.0 kWh regardless of which stage is
// active on any given tick.
// =============================================================================

/** Shape of a single entry in STAGE_ENERGY_PROFILE. Mirrors IStageEnergyEntry in @wpt/types. */
export interface IStageEnergyEntry {
  /** Stage name — must match PLC_STATUS keys exactly (see cycleEngine.ts:10-27). */
  name:
    | 'LOADING'
    | 'SHREDDING'
    | 'HEATING'
    | 'EVAPORATION'
    | 'OVERHEATING'
    | 'HOLDING'
    | 'COOLING'
    | 'FINAL_DRYING'
    | 'DISCHARGE';
  /** kWh added to energyConsumption per simulator tick while this stage is active. Must be >= 0 (ESIM-03). */
  kwhPerTick: number;
}

const DEFAULT_STAGE_ENERGY_PROFILE: readonly IStageEnergyEntry[] = [
  { name: 'LOADING',      kwhPerTick: 0.05 }, // index 0 — motor only
  { name: 'SHREDDING',    kwhPerTick: 0.20 }, // index 1 — transitional
  { name: 'HEATING',      kwhPerTick: 0.40 }, // index 2 — sustained heat (ramp)
  { name: 'EVAPORATION',  kwhPerTick: 0.45 }, // index 3 — sustained heat (dominant)
  { name: 'OVERHEATING',  kwhPerTick: 0.50 }, // index 4 — sustained heat (peak)
  { name: 'HOLDING',      kwhPerTick: 0.35 }, // index 5 — sustained heat (decline)
  { name: 'COOLING',      kwhPerTick: 0.15 }, // index 6 — transitional
  { name: 'FINAL_DRYING', kwhPerTick: 0.18 }, // index 7 — transitional
  { name: 'DISCHARGE',    kwhPerTick: 0.10 }, // index 8 — motor + brief vacuum
];

/**
 * The active per-stage energy profile. Read by cycleEngine.tick() every tick.
 * Mutated only by overrideStageEnergyProfileForTest / restoreStageEnergyProfile.
 *
 * NOTE: this is a module-private let binding. Production code paths never
 * mutate it. Tests call the override hook and MUST restore in afterEach /
 * finally so the next test sees the default profile.
 */
let _activeStageEnergyProfile: readonly IStageEnergyEntry[] = DEFAULT_STAGE_ENERGY_PROFILE;

/**
 * Read-only view of the DEFAULT profile (always returns the 9-stage realistic
 * rates regardless of any active test-mode override). The RED test in
 * cycleEnergyCurve.test.ts asserts shape + monotonicity against this constant.
 */
export const STAGE_ENERGY_PROFILE: readonly IStageEnergyEntry[] = DEFAULT_STAGE_ENERGY_PROFILE;

/**
 * The profile currently in use by cycleEngine.tick(). Equals STAGE_ENERGY_PROFILE
 * except between overrideStageEnergyProfileForTest and restoreStageEnergyProfile
 * calls. cycleEngine imports this accessor so the override takes effect without
 * a module re-import.
 */
export function getStageEnergyProfile(): readonly IStageEnergyEntry[] {
  return _activeStageEnergyProfile;
}

/**
 * Test-mode override — replace the active profile with a uniform kWh/tick rate
 * across all 9 stages. Plan 19-12's deterministic 1000 → 1015 kWh / 5-minute
 * fixture calls this with `{ uniformKwhPerTick: 0.75 }` so 20 ticks integrates
 * to exactly 15.0 kWh independent of which stages the engine visits.
 *
 * Tests MUST call restoreStageEnergyProfile() in afterEach / finally so the
 * next test sees the default profile.
 */
export function overrideStageEnergyProfileForTest(options: { uniformKwhPerTick: number }): void {
  const rate = options.uniformKwhPerTick;
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(
      `overrideStageEnergyProfileForTest: uniformKwhPerTick must be a non-negative finite number, got ${rate}`,
    );
  }
  const uniform: readonly IStageEnergyEntry[] = DEFAULT_STAGE_ENERGY_PROFILE.map((entry) => ({
    name: entry.name,
    kwhPerTick: rate,
  }));
  if (uniform.length !== 9) {
    // Defensive: STAGE_ENERGY_PROFILE must have exactly 9 entries — this would
    // indicate a regression in the default profile shape, not a caller error.
    throw new Error(
      `STAGE_ENERGY_PROFILE must have exactly 9 entries (one per PLC stage), got ${uniform.length}`,
    );
  }
  _activeStageEnergyProfile = uniform;
}

/** Restore the default profile. Tests MUST call this in afterEach / finally. */
export function restoreStageEnergyProfile(): void {
  _activeStageEnergyProfile = DEFAULT_STAGE_ENERGY_PROFILE;
}

/** 48 Italian names: tags 1-10 Admin, 11-20 Maintenance, 21-48 Operator */
export const ITALIAN_NAMES: string[] = [
  // Admin (group 2) - tags 1-10
  'Mario Rossi',
  'Luigi Bianchi',
  'Alessandro Ferrari',
  'Francesco Romano',
  'Andrea Colombo',
  'Marco Russo',
  'Paolo Ricci',
  'Giovanni Marino',
  'Roberto Greco',
  'Davide Bruno',
  // Maintenance (group 1) - tags 11-20
  'Luca Gallo',
  'Matteo Conti',
  'Simone Mancini',
  'Fabio Rizzo',
  'Stefano Lombardi',
  'Antonio Moretti',
  'Giuseppe Barbieri',
  'Claudio Fontana',
  'Sergio Santoro',
  'Massimo Marini',
  // Operators (group 0) - tags 21-48
  'Vincenzo Costa',
  'Emanuele Giordano',
  'Daniele Rinaldi',
  'Pietro Marchetti',
  'Tommaso Leone',
  'Federico Martinelli',
  'Alberto Caruso',
  'Giacomo Ferrara',
  'Lorenzo Vitale',
  'Nicola Gatti',
  'Enrico Pellegrini',
  'Salvatore Montanari',
  'Angelo Neri',
  'Riccardo Fabbri',
  'Carlo Grassi',
  'Filippo Coppola',
  'Diego Battaglia',
  'Alessio De Luca',
  'Cristiano Rizzi',
  'Mirko Palumbo',
  'Omar Sartori',
  'Gianluca Bernardi',
  'Dario Valentini',
  'Mauro Parisi',
  'Ivano Sala',
  'Franco Cattaneo',
  'Piero Silvestri',
  'Aldo Benedetti',
];

/** Sensor ranges for noise generation and validation */
export interface ISensorRange {
  min: number;
  max: number;
  typicalRunning: number;
  typicalIdle: number;
}

export const SENSOR_RANGES: Record<string, ISensorRange> = {
  garbageTemp: { min: -20, max: 200, typicalRunning: 180, typicalIdle: 22 },
  holdingTempSetpoint: { min: 0, max: 250, typicalRunning: 190, typicalIdle: 0 },
  chamberPressure: { min: -100, max: 1800, typicalRunning: 500, typicalIdle: 10 },
  mainMotorSpeed: { min: -3000, max: 3000, typicalRunning: 2000, typicalIdle: 0 },
  mainMotorTorque: { min: -300, max: 300, typicalRunning: 100, typicalIdle: 0 },
  mainMotorCurrent: { min: -1000, max: 1000, typicalRunning: 300, typicalIdle: 0 },
  vacuumPumpSpeed01: { min: -3000, max: 3000, typicalRunning: 2200, typicalIdle: 0 },
  vacuumPumpSpeed02: { min: -3000, max: 3000, typicalRunning: 2000, typicalIdle: 0 },
  thermoLeftLower: { min: -20, max: 200, typicalRunning: 150, typicalIdle: 22 },
  thermoLeftMedium: { min: -20, max: 200, typicalRunning: 160, typicalIdle: 22 },
  thermoLeftUpper: { min: -20, max: 200, typicalRunning: 170, typicalIdle: 22 },
  thermoRightLower: { min: -20, max: 200, typicalRunning: 148, typicalIdle: 22 },
  thermoRightMedium: { min: -20, max: 200, typicalRunning: 158, typicalIdle: 22 },
  thermoRightUpper: { min: -20, max: 200, typicalRunning: 168, typicalIdle: 22 },
  thermoLeftHighLower: { min: -20, max: 200, typicalRunning: 140, typicalIdle: 22 },
  thermoLeftHighMedium: { min: -20, max: 200, typicalRunning: 145, typicalIdle: 22 },
  thermoLeftHighUpper: { min: -20, max: 200, typicalRunning: 155, typicalIdle: 22 },
  thermoRightHighLower: { min: -20, max: 200, typicalRunning: 138, typicalIdle: 22 },
  energyConsumption: { min: 0, max: 99999, typicalRunning: 450.5, typicalIdle: 0 },
  rmsCurrL1: { min: 0, max: 1000, typicalRunning: 120.3, typicalIdle: 0 },
  rmsCurrL2: { min: 0, max: 1000, typicalRunning: 118.7, typicalIdle: 0 },
  rmsCurrL3: { min: 0, max: 1000, typicalRunning: 121.1, typicalIdle: 0 },
  rmsCurrN: { min: 0, max: 100, typicalRunning: 2.5, typicalIdle: 0 },
  waterConsumption: { min: 0, max: 99999, typicalRunning: 12.8, typicalIdle: 0 },
};

/** Disabled tag IDs for default users */
const DISABLED_TAGS = new Set([3, 15, 25, 30, 42]);

/** Create default machine data snapshot with idle/ambient values */
export function createDefaultMachineData(): IMachineSnapshot {
  return {
    // INT fields - idle/ambient values
    thermoLeftLower: 22,
    thermoLeftMedium: 22,
    thermoLeftUpper: 22,
    thermoRightLower: 22,
    thermoRightMedium: 22,
    thermoRightUpper: 22,
    thermoLeftHighLower: 22,
    thermoLeftHighMedium: 22,
    thermoLeftHighUpper: 22,
    thermoRightHighLower: 22,
    garbageTemp: 22,
    holdingTempSetpoint: 0,
    chamberPressure: 10,
    mainMotorSpeed: 0,
    mainMotorTorque: 0,
    mainMotorCurrent: 0,
    vacuumPumpSpeed01: 0,
    vacuumPumpSpeed02: 0,
    spareInt19: 0,
    spareInt20: 0,
    spareInt21: 0,
    spareInt22: 0,
    spareInt23: 0,
    spareInt24: 0,
    spareInt25: 0,
    spareInt26: 0,
    spareInt27: 0,
    spareInt28: 0,
    spareInt29: 0,
    spareInt30: 0,
    spareInt31: 0,
    spareInt32: 0,
    spareInt33: 0,
    spareInt34: 0,
    spareInt35: 0,
    spareInt36: 0,
    spareInt37: 0,
    spareInt38: 0,
    spareInt39: 0,
    spareInt40: 0,
    spareInt41: 0,
    spareInt42: 0,
    spareInt43: 0,
    spareInt44: 0,
    spareInt45: 0,
    spareInt46: 0,
    spareInt47: 0,
    spareInt48: 0,
    spareInt49: 0,
    spareInt50: 0,
    spareInt51: 0,
    spareInt52: 0,
    spareInt53: 0,
    spareInt54: 0,
    spareInt55: 0,
    spareInt56: 0,
    materialInputWeight: 0,
    materialOutputWeight: 0,
    selectedCycle: CycleType.NO_CYCLE,
    currentPhase: MachinePhase.NO_SELECTION,
    machineStatus: MachineStatus.LOADING,
    spareInt62: 0,
    spareInt63: 0,
    spareInt64: 0,
    spareInt65: 0,
    spareInt66: 0,
    spareInt67: 0,
    spareInt68: 0,
    spareInt69: 0,
    spareInt70: 0,
    spareInt71: 0,
    spareInt72: 0,
    // DINT fields
    completedCycles: 0,
    spareDint01: 0,
    // STRING fields
    user: 'ROSSI M.',
    supervisor: 'BIANCHI L.',
    orderNumber: 'ORD-2024-0847',
    serialNumber: 'WPT-SH400-0023',
    spareString01: '',
    // REAL fields
    energyConsumption: 0,
    rmsCurrL1: 0,
    rmsCurrL2: 0,
    rmsCurrL3: 0,
    rmsCurrN: 0,
    waterConsumption: 0,
    spareReal01: 0,
    // BYTE fields
    thermoLeftLowSel: 0,
    thermoLeftMedSel: 0,
    thermoLeftHighSel: 0,
    thermoRightLowSel: 0,
    thermoRightMedSel: 0,
    thermoRightHighSel: 0,
  };
}

/** Create 48 default RFID users with Italian names and correct group assignments */
export function createDefaultUsers(): IRfidUser[] {
  return ITALIAN_NAMES.map((name, index): IRfidUser => {
    const tagId = index + 1;
    let group: RfidUserGroup;
    if (tagId <= 10) {
      group = RfidUserGroup.ADMIN;
    } else if (tagId <= 20) {
      group = RfidUserGroup.MAINTENANCE;
    } else {
      group = RfidUserGroup.OPERATOR;
    }
    return {
      tagId,
      name,
      group,
      enabled: !DISABLED_TAGS.has(tagId),
    };
  });
}

/** Create default job data with all fields at their zero/empty state */
export function createDefaultJob(): IJobData {
  return {
    supervisor: '',
    orderNumber: '',
    serialNumber: '',
    remoteJobEnable: RemoteJobEnable.NO_REQUEST,
    maintenanceRequest: MaintenanceRequest.NO_REQUEST,
    remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
    cycleType: CycleType.NO_CYCLE,
  };
}
