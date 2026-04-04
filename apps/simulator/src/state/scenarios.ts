import {
  CycleType,
  MachinePhase,
  MachineStatus,
} from '@wpt/types';
import type { IMachineSnapshot, IAlarmWords } from '@wpt/types';
import { updateState } from './simulatorState.js';

export interface IScenarioPreset {
  name: string;
  machine: Partial<IMachineSnapshot>;
  alarms: IAlarmWords;
}

export const SCENARIOS: Record<string, IScenarioPreset> = {
  normal: {
    name: 'Normal Operation',
    machine: {
      selectedCycle: CycleType.DRY_MIXED,
      machineStatus: MachineStatus.RUNNING,
      currentPhase: MachinePhase.PROCESSING,
      garbageTemp: 180,
      holdingTempSetpoint: 190,
      chamberPressure: 500,
      mainMotorSpeed: 2000,
      mainMotorTorque: 100,
      mainMotorCurrent: 300,
      vacuumPumpSpeed01: 2200,
      vacuumPumpSpeed02: 2000,
      thermoLeftLower: 150,
      thermoLeftMedium: 160,
      thermoLeftUpper: 170,
      thermoRightLower: 148,
      thermoRightMedium: 158,
      thermoRightUpper: 168,
      thermoLeftHighLower: 140,
      thermoLeftHighMedium: 145,
      thermoLeftHighUpper: 155,
      thermoRightHighLower: 138,
      energyConsumption: 450.5,
      rmsCurrL1: 120.3,
      rmsCurrL2: 118.7,
      rmsCurrL3: 121.1,
      rmsCurrN: 2.5,
      waterConsumption: 12.8,
      materialInputWeight: 500,
      completedCycles: 42,
      thermoLeftLowSel: 1,
      thermoLeftMedSel: 1,
      thermoLeftHighSel: 1,
      thermoRightLowSel: 1,
      thermoRightMedSel: 1,
      thermoRightHighSel: 1,
      user: 'ROSSI M.',
      supervisor: 'BIANCHI L.',
      orderNumber: 'ORD-2024-0847',
      serialNumber: 'WPT-SH400-0023',
    },
    alarms: { words: new Array<number>(40).fill(0) },
  },

  alarmStorm: {
    name: 'Alarm Storm',
    machine: {
      selectedCycle: CycleType.DRY_MIXED,
      machineStatus: MachineStatus.ALARM,
      currentPhase: MachinePhase.PROCESSING,
      garbageTemp: 220,
      chamberPressure: 1500,
      mainMotorSpeed: 0,
      mainMotorTorque: 0,
      mainMotorCurrent: 0,
      vacuumPumpSpeed01: 0,
      vacuumPumpSpeed02: 0,
      thermoLeftLowSel: 1,
      thermoLeftMedSel: 1,
      thermoLeftHighSel: 1,
      thermoRightLowSel: 1,
      thermoRightMedSel: 1,
      thermoRightHighSel: 1,
      user: 'ROSSI M.',
      supervisor: 'BIANCHI L.',
      orderNumber: 'ORD-2024-0847',
      serialNumber: 'WPT-SH400-0023',
    },
    alarms: {
      words: [
        0x0303, // bits 0,1,8,9 set = 4 alarms
        0x0209, // bits 0,3,9 set = 3 alarms
        0x2001, // bits 0,13 set = 2 alarms
        ...new Array<number>(37).fill(0),
      ],
    },
  },

  maintenance: {
    name: 'Maintenance Mode',
    machine: {
      selectedCycle: CycleType.NO_CYCLE,
      machineStatus: MachineStatus.MAINTENANCE,
      currentPhase: MachinePhase.IDLE,
      garbageTemp: 22,
      holdingTempSetpoint: 0,
      chamberPressure: 0,
      mainMotorSpeed: 0,
      mainMotorTorque: 0,
      mainMotorCurrent: 0,
      vacuumPumpSpeed01: 0,
      vacuumPumpSpeed02: 0,
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
      thermoLeftLowSel: 0,
      thermoLeftMedSel: 0,
      thermoLeftHighSel: 0,
      thermoRightLowSel: 0,
      thermoRightMedSel: 0,
      thermoRightHighSel: 0,
      energyConsumption: 0,
      rmsCurrL1: 0,
      rmsCurrL2: 0,
      rmsCurrL3: 0,
      rmsCurrN: 0,
      waterConsumption: 0,
      user: '',
      supervisor: '',
      orderNumber: '',
      serialNumber: '',
    },
    alarms: { words: new Array<number>(40).fill(0) },
  },

  idle: {
    name: 'Idle / Standby',
    machine: {
      selectedCycle: CycleType.NO_CYCLE,
      machineStatus: MachineStatus.STANDBY,
      currentPhase: MachinePhase.IDLE,
      garbageTemp: 22,
      holdingTempSetpoint: 0,
      chamberPressure: 10,
      mainMotorSpeed: 0,
      mainMotorTorque: 0,
      mainMotorCurrent: 0,
      vacuumPumpSpeed01: 0,
      vacuumPumpSpeed02: 0,
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
      thermoLeftLowSel: 0,
      thermoLeftMedSel: 0,
      thermoLeftHighSel: 0,
      thermoRightLowSel: 0,
      thermoRightMedSel: 0,
      thermoRightHighSel: 0,
      energyConsumption: 0,
      rmsCurrL1: 0,
      rmsCurrL2: 0,
      rmsCurrL3: 0,
      rmsCurrN: 0,
      waterConsumption: 0,
      user: '',
      supervisor: '',
      orderNumber: '',
      serialNumber: '',
    },
    alarms: { words: new Array<number>(40).fill(0) },
  },
};

/** Apply a named scenario preset to the simulator state */
export function applyScenario(name: keyof typeof SCENARIOS): void {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${String(name)}`);
  }
  updateState({
    machine: scenario.machine,
    alarms: scenario.alarms,
  });
}
