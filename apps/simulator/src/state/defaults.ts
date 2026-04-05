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
