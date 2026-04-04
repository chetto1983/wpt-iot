import type { IMachineSnapshot } from '@wpt/types';

/** Gauge card definitions: field key + translation key under dashboard.gauges.* */
export const GAUGE_DEFS = [
  { key: 'garbageTemp' as keyof IMachineSnapshot, tKey: 'garbageTemp' },
  { key: 'chamberPressure' as keyof IMachineSnapshot, tKey: 'chamberPressure' },
  { key: 'mainMotorSpeed' as keyof IMachineSnapshot, tKey: 'mainMotorSpeed' },
  { key: 'vacuumPumpSpeed01' as keyof IMachineSnapshot, tKey: 'vacuumPumpSpeed01' },
] as const;

/** Process Snapshot card fields */
export const PROCESS_FIELDS = [
  'selectedCycle',
  'currentPhase',
  'machineStatus',
  'materialInputWeight',
  'completedCycles',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;

/** Job Snapshot card fields */
export const JOB_FIELDS = [
  'user',
  'supervisor',
  'orderNumber',
  'serialNumber',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;

/** WPT-only technical signal groups -- each group has a translation key and field list */
export const TECHNICAL_GROUPS = [
  {
    groupKey: 'thermalZones',
    fields: [
      'thermoLeftLower', 'thermoLeftMedium', 'thermoLeftUpper',
      'thermoRightLower', 'thermoRightMedium', 'thermoRightUpper',
      'thermoLeftHighLower', 'thermoLeftHighMedium', 'thermoLeftHighUpper',
      'thermoRightHighLower', 'holdingTempSetpoint',
    ] as Array<keyof IMachineSnapshot>,
  },
  {
    groupKey: 'driveAndVacuum',
    fields: ['mainMotorTorque', 'vacuumPumpSpeed02'] as Array<keyof IMachineSnapshot>,
  },
  {
    groupKey: 'electricalLoad',
    fields: ['rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3', 'rmsCurrN'] as Array<keyof IMachineSnapshot>,
  },
  {
    groupKey: 'selectorBytes',
    fields: [
      'thermoLeftLowSel', 'thermoLeftMedSel', 'thermoLeftHighSel',
      'thermoRightLowSel', 'thermoRightMedSel', 'thermoRightHighSel',
    ] as Array<keyof IMachineSnapshot>,
  },
  {
    groupKey: 'reservedSignal',
    fields: ['spareReal01'] as Array<keyof IMachineSnapshot>,
  },
] as const;
