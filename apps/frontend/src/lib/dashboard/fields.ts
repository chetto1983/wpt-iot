import type { IMachineSnapshot } from '@wpt/types';
import gaugeConfig from '@/config/gauges.json';

/** Gauge sub-arc definition from JSON config */
export interface IGaugeSubArc {
  limit: number;
  color: string;
}

/** Gauge definition loaded from config/gauges.json */
export interface IGaugeDef {
  key: keyof IMachineSnapshot;
  tKey: string;
  unit: string;
  min: number;
  max: number;
  subArcs: IGaugeSubArc[];
}

/** Gauge card definitions loaded from JSON config */
export const GAUGE_DEFS: IGaugeDef[] = gaugeConfig as IGaugeDef[];

/** Process Snapshot card fields */
export const PROCESS_FIELDS = [
  'selectedCycle',
  'currentPhase',
  'machineStatus',
  'cycleStatus',           // V03 — Cycle_Status verdict (decoded via decodeCycleStatus)
  'materialInputWeight',
  'completedCycles',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;

/** Job Snapshot card fields */
export const JOB_FIELDS = [
  'user',
  'supervisor',
  'orderNumber',
  'serialNumber',
  'container',             // V03 — INT slot S1_I_DATO_72
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
    // V03 — three-phase line voltages + power factor (S1_R_DATO_7..13)
    groupKey: 'lineVoltages',
    fields: [
      'lineVoltL1L2', 'lineVoltL2L3', 'lineVoltL3L1',
      'lineNeutralVoltL1', 'lineNeutralVoltL2', 'lineNeutralVoltL3',
      'pfTotal',
    ] as Array<keyof IMachineSnapshot>,
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
    fields: ['spareReal01', 'spareReal02'] as Array<keyof IMachineSnapshot>,
  },
] as const;
