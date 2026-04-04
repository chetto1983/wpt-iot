import { MachinePhase, CycleType } from '@wpt/types';
import type { IMachineSnapshot } from '@wpt/types';
import { getState, updateState } from './simulatorState.js';

/**
 * PLC wire-format constants for S1_I_DATO_61 (machineStatus).
 * These are the raw numeric values sent over UDP, NOT the MachineStatus TS enum.
 * PLC cycle sub-statuses: 0=LOADING through 8=DISCHARGE.
 */
const PLC_STATUS = {
  LOADING: 0,
  SHREDDING: 1,
  HEATING: 2,
  EVAPORATION: 3,
  OVERHEATING: 4,
  HOLDING: 5,
  COOLING: 6,
  FINAL_DRYING: 7,
  DISCHARGE: 8,
} as const;

type PlcStatusKey = keyof typeof PLC_STATUS;

const STAGE_ORDER: PlcStatusKey[] = [
  'LOADING', 'SHREDDING', 'HEATING', 'EVAPORATION', 'OVERHEATING',
  'HOLDING', 'COOLING', 'FINAL_DRYING', 'DISCHARGE',
];

interface IStageProfile {
  name: PlcStatusKey;
  durationTicks: number;
  currentPhase: MachinePhase;
  targets: Partial<IMachineSnapshot>;
}

/**
 * Stage profiles indexed 0-8, defining duration, phase, and target sensor values
 * for each PLC processing stage. Timings compressed for dev (not real hours).
 */
const STAGE_PROFILES: IStageProfile[] = [
  {
    name: 'LOADING',
    durationTicks: 4,  // 60s
    currentPhase: MachinePhase.LOADING,
    targets: {
      garbageTemp: 30,
      chamberPressure: 20,
      mainMotorSpeed: 500,
      mainMotorTorque: 25,
      mainMotorCurrent: 75,
      vacuumPumpSpeed01: 0,
      vacuumPumpSpeed02: 0,
      holdingTempSetpoint: 0,
      thermoLeftLower: 28, thermoLeftMedium: 30, thermoLeftUpper: 32,
      thermoRightLower: 27, thermoRightMedium: 29, thermoRightUpper: 31,
      thermoLeftHighLower: 26, thermoLeftHighMedium: 28, thermoLeftHighUpper: 30,
      thermoRightHighLower: 25,
      rmsCurrL1: 30, rmsCurrL2: 29.5, rmsCurrL3: 30.5, rmsCurrN: 0.8,
    },
  },
  {
    name: 'SHREDDING',
    durationTicks: 6,  // 90s
    currentPhase: MachinePhase.PROCESSING,
    targets: {
      garbageTemp: 50,
      chamberPressure: 50,
      mainMotorSpeed: 2200,
      mainMotorTorque: 110,
      mainMotorCurrent: 330,
      vacuumPumpSpeed01: 0,
      vacuumPumpSpeed02: 0,
      holdingTempSetpoint: 0,
      thermoLeftLower: 45, thermoLeftMedium: 48, thermoLeftUpper: 52,
      thermoRightLower: 44, thermoRightMedium: 47, thermoRightUpper: 51,
      thermoLeftHighLower: 42, thermoLeftHighMedium: 46, thermoLeftHighUpper: 50,
      thermoRightHighLower: 41,
      rmsCurrL1: 132, rmsCurrL2: 130.2, rmsCurrL3: 133.5, rmsCurrN: 3.5,
    },
  },
  {
    name: 'HEATING',
    durationTicks: 8,  // 120s
    currentPhase: MachinePhase.PROCESSING,
    targets: {
      garbageTemp: 120,
      chamberPressure: 200,
      mainMotorSpeed: 1800,
      mainMotorTorque: 90,
      mainMotorCurrent: 270,
      vacuumPumpSpeed01: 800,
      vacuumPumpSpeed02: 600,
      holdingTempSetpoint: 190,
      thermoLeftLower: 110, thermoLeftMedium: 118, thermoLeftUpper: 125,
      thermoRightLower: 108, thermoRightMedium: 116, thermoRightUpper: 123,
      thermoLeftHighLower: 105, thermoLeftHighMedium: 112, thermoLeftHighUpper: 120,
      thermoRightHighLower: 103,
      rmsCurrL1: 108, rmsCurrL2: 106.5, rmsCurrL3: 109.2, rmsCurrN: 2.8,
    },
  },
  {
    name: 'EVAPORATION',
    durationTicks: 10, // 150s
    currentPhase: MachinePhase.PROCESSING,
    targets: {
      garbageTemp: 170,
      chamberPressure: 800,
      mainMotorSpeed: 1500,
      mainMotorTorque: 75,
      mainMotorCurrent: 225,
      vacuumPumpSpeed01: 2200,
      vacuumPumpSpeed02: 2000,
      holdingTempSetpoint: 190,
      thermoLeftLower: 162, thermoLeftMedium: 168, thermoLeftUpper: 175,
      thermoRightLower: 160, thermoRightMedium: 166, thermoRightUpper: 173,
      thermoLeftHighLower: 158, thermoLeftHighMedium: 164, thermoLeftHighUpper: 170,
      thermoRightHighLower: 156,
      rmsCurrL1: 90, rmsCurrL2: 88.7, rmsCurrL3: 91.2, rmsCurrN: 2.3,
    },
  },
  {
    name: 'OVERHEATING',
    durationTicks: 4,  // 60s
    currentPhase: MachinePhase.PROCESSING,
    targets: {
      garbageTemp: 195,
      chamberPressure: 600,
      mainMotorSpeed: 1500,
      mainMotorTorque: 75,
      mainMotorCurrent: 225,
      vacuumPumpSpeed01: 2200,
      vacuumPumpSpeed02: 2000,
      holdingTempSetpoint: 190,
      thermoLeftLower: 188, thermoLeftMedium: 193, thermoLeftUpper: 198,
      thermoRightLower: 186, thermoRightMedium: 191, thermoRightUpper: 196,
      thermoLeftHighLower: 184, thermoLeftHighMedium: 189, thermoLeftHighUpper: 194,
      thermoRightHighLower: 182,
      rmsCurrL1: 90, rmsCurrL2: 88.7, rmsCurrL3: 91.2, rmsCurrN: 2.3,
    },
  },
  {
    name: 'HOLDING',
    durationTicks: 6,  // 90s
    currentPhase: MachinePhase.DRYING,
    targets: {
      garbageTemp: 190,
      chamberPressure: 500,
      mainMotorSpeed: 1200,
      mainMotorTorque: 60,
      mainMotorCurrent: 180,
      vacuumPumpSpeed01: 2000,
      vacuumPumpSpeed02: 1800,
      holdingTempSetpoint: 190,
      thermoLeftLower: 184, thermoLeftMedium: 188, thermoLeftUpper: 192,
      thermoRightLower: 182, thermoRightMedium: 186, thermoRightUpper: 190,
      thermoLeftHighLower: 180, thermoLeftHighMedium: 184, thermoLeftHighUpper: 188,
      thermoRightHighLower: 178,
      rmsCurrL1: 72, rmsCurrL2: 70.8, rmsCurrL3: 73.1, rmsCurrN: 1.8,
    },
  },
  {
    name: 'COOLING',
    durationTicks: 8,  // 120s
    currentPhase: MachinePhase.DRYING,
    targets: {
      garbageTemp: 120,
      chamberPressure: 300,
      mainMotorSpeed: 800,
      mainMotorTorque: 40,
      mainMotorCurrent: 120,
      vacuumPumpSpeed01: 1200,
      vacuumPumpSpeed02: 1000,
      holdingTempSetpoint: 0,
      thermoLeftLower: 115, thermoLeftMedium: 118, thermoLeftUpper: 122,
      thermoRightLower: 113, thermoRightMedium: 116, thermoRightUpper: 120,
      thermoLeftHighLower: 110, thermoLeftHighMedium: 114, thermoLeftHighUpper: 118,
      thermoRightHighLower: 108,
      rmsCurrL1: 48, rmsCurrL2: 47.2, rmsCurrL3: 48.8, rmsCurrN: 1.2,
    },
  },
  {
    name: 'FINAL_DRYING',
    durationTicks: 6,  // 90s
    currentPhase: MachinePhase.DRYING,
    targets: {
      garbageTemp: 80,
      chamberPressure: 100,
      mainMotorSpeed: 600,
      mainMotorTorque: 30,
      mainMotorCurrent: 90,
      vacuumPumpSpeed01: 600,
      vacuumPumpSpeed02: 400,
      holdingTempSetpoint: 0,
      thermoLeftLower: 75, thermoLeftMedium: 78, thermoLeftUpper: 82,
      thermoRightLower: 73, thermoRightMedium: 76, thermoRightUpper: 80,
      thermoLeftHighLower: 70, thermoLeftHighMedium: 74, thermoLeftHighUpper: 78,
      thermoRightHighLower: 68,
      rmsCurrL1: 36, rmsCurrL2: 35.4, rmsCurrL3: 36.6, rmsCurrN: 0.9,
    },
  },
  {
    name: 'DISCHARGE',
    durationTicks: 3,  // 45s
    currentPhase: MachinePhase.UNLOADING,
    targets: {
      garbageTemp: 60,
      chamberPressure: 20,
      mainMotorSpeed: 300,
      mainMotorTorque: 15,
      mainMotorCurrent: 45,
      vacuumPumpSpeed01: 0,
      vacuumPumpSpeed02: 0,
      holdingTempSetpoint: 0,
      thermoLeftLower: 56, thermoLeftMedium: 58, thermoLeftUpper: 62,
      thermoRightLower: 54, thermoRightMedium: 57, thermoRightUpper: 61,
      thermoLeftHighLower: 52, thermoLeftHighMedium: 55, thermoLeftHighUpper: 58,
      thermoRightHighLower: 50,
      rmsCurrL1: 18, rmsCurrL2: 17.6, rmsCurrL3: 18.3, rmsCurrN: 0.5,
    },
  },
];

/** Lerp factor for exponential ease toward target values */
const LERP_FACTOR = 0.3;

/**
 * Auto-cycle progression engine. Advances the machine through all 9 PLC
 * processing stages (LOADING through DISCHARGE) in a continuous loop,
 * updating sensor values with smooth interpolation each tick.
 */
export class CycleEngine {
  enabled = true;
  currentStageIndex = 0;
  ticksInStage = 0;
  completedCycles = 0;
  private _materialInputWeight = 500;

  /** Called every data broadcast interval (15s). Advances stage and interpolates sensors. */
  tick(): void {
    if (!this.enabled) return;

    this.ticksInStage++;
    const profile = STAGE_PROFILES[this.currentStageIndex]!;
    const state = getState();
    const current = state.machine;

    // Interpolate sensor values toward stage targets
    const interpolated: Partial<IMachineSnapshot> = {};
    for (const [key, targetVal] of Object.entries(profile.targets)) {
      const field = key as keyof IMachineSnapshot;
      const currentVal = current[field] as number;
      const target = targetVal as number;
      (interpolated as Record<string, number>)[key] = currentVal + (target - currentVal) * LERP_FACTOR;
    }

    // Round INT fields, keep REAL fields as-is
    const intFields = new Set([
      'garbageTemp', 'chamberPressure', 'mainMotorSpeed', 'mainMotorTorque',
      'mainMotorCurrent', 'vacuumPumpSpeed01', 'vacuumPumpSpeed02',
      'holdingTempSetpoint',
      'thermoLeftLower', 'thermoLeftMedium', 'thermoLeftUpper',
      'thermoRightLower', 'thermoRightMedium', 'thermoRightUpper',
      'thermoLeftHighLower', 'thermoLeftHighMedium', 'thermoLeftHighUpper',
      'thermoRightHighLower',
    ]);
    for (const [key, val] of Object.entries(interpolated)) {
      if (intFields.has(key)) {
        (interpolated as Record<string, number>)[key] = Math.round(val as number);
      }
    }

    // Accumulate energy and water consumption
    const energyIncrement = (current.mainMotorSpeed / 2200) * (5 + Math.random() * 10);
    const waterIncrement = current.vacuumPumpSpeed01 > 0 ? (0.5 + Math.random() * 1.5) : 0;
    interpolated.energyConsumption = parseFloat((current.energyConsumption + energyIncrement).toFixed(1));
    interpolated.waterConsumption = parseFloat((current.waterConsumption + waterIncrement).toFixed(1));

    // Handle DISCHARGE output weight growth
    if (this.currentStageIndex === PLC_STATUS.DISCHARGE) {
      const progress = this.ticksInStage / profile.durationTicks;
      interpolated.materialOutputWeight = Math.round(this._materialInputWeight * 0.65 * progress);
    }

    // Check stage transition
    if (this.ticksInStage >= profile.durationTicks) {
      this.currentStageIndex++;
      this.ticksInStage = 0;

      // Wrap: DISCHARGE -> LOADING (new cycle)
      if (this.currentStageIndex > PLC_STATUS.DISCHARGE) {
        this.currentStageIndex = PLC_STATUS.LOADING;
        this.completedCycles++;
        this._materialInputWeight = 400 + Math.round(Math.random() * 200);
        interpolated.materialInputWeight = this._materialInputWeight;
        interpolated.materialOutputWeight = 0;
        interpolated.completedCycles = this.completedCycles;
      }
    }

    const nextProfile = STAGE_PROFILES[this.currentStageIndex]!;

    updateState({
      machine: {
        ...interpolated,
        machineStatus: PLC_STATUS[nextProfile.name],
        currentPhase: nextProfile.currentPhase,
        selectedCycle: CycleType.DRY_MIXED,
      },
    });
  }

  /** Pause auto-cycle (e.g., when user manually overrides state) */
  pause(): void {
    this.enabled = false;
  }

  /** Resume auto-cycle, resetting tick counter for current stage */
  resume(): void {
    this.enabled = true;
    this.ticksInStage = 0;
  }

  /** Reset to initial state: stage 0 (LOADING), enabled */
  reset(): void {
    this.currentStageIndex = 0;
    this.ticksInStage = 0;
    this.completedCycles = 0;
    this._materialInputWeight = 500;
    this.enabled = true;
  }

  /** Get current engine status for the API */
  getStatus(): {
    enabled: boolean;
    currentStageIndex: number;
    stageName: string;
    ticksInStage: number;
    totalTicks: number;
    completedCycles: number;
  } {
    const profile = STAGE_PROFILES[this.currentStageIndex]!;
    return {
      enabled: this.enabled,
      currentStageIndex: this.currentStageIndex,
      stageName: STAGE_ORDER[this.currentStageIndex]!,
      ticksInStage: this.ticksInStage,
      totalTicks: profile.durationTicks,
      completedCycles: this.completedCycles,
    };
  }
}

/** Singleton cycle engine instance */
export const cycleEngine = new CycleEngine();
