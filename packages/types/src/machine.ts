import { z } from 'zod/v4';

/**
 * Machine data snapshot from Mappatura AC500->IOT_9090.
 * 72 INT + 2 DINT + 5 STRING[20] + 15 REAL + 6 BYTE = 100 fields total (V03).
 */
export interface IMachineSnapshot {
  // --- INT fields (S1_I_DATO_1 through S1_I_DATO_72) — 16-bit signed ---
  thermoLeftLower: number;          // S1_I_DATO_1
  thermoLeftMedium: number;         // S1_I_DATO_2
  thermoLeftUpper: number;          // S1_I_DATO_3
  thermoRightLower: number;         // S1_I_DATO_4
  thermoRightMedium: number;        // S1_I_DATO_5
  thermoRightUpper: number;         // S1_I_DATO_6
  thermoLeftHighLower: number;      // S1_I_DATO_7
  thermoLeftHighMedium: number;     // S1_I_DATO_8
  thermoLeftHighUpper: number;      // S1_I_DATO_9
  thermoRightHighLower: number;     // S1_I_DATO_10
  garbageTemp: number;              // S1_I_DATO_11
  holdingTempSetpoint: number;      // S1_I_DATO_12
  chamberPressure: number;          // S1_I_DATO_13
  mainMotorSpeed: number;           // S1_I_DATO_14
  mainMotorTorque: number;          // S1_I_DATO_15
  mainMotorCurrent: number;         // S1_I_DATO_16
  vacuumPumpSpeed01: number;        // S1_I_DATO_17
  vacuumPumpSpeed02: number;        // S1_I_DATO_18
  spareInt19: number;               // S1_I_DATO_19
  spareInt20: number;               // S1_I_DATO_20
  spareInt21: number;               // S1_I_DATO_21
  spareInt22: number;               // S1_I_DATO_22
  spareInt23: number;               // S1_I_DATO_23
  spareInt24: number;               // S1_I_DATO_24
  spareInt25: number;               // S1_I_DATO_25
  spareInt26: number;               // S1_I_DATO_26
  spareInt27: number;               // S1_I_DATO_27
  spareInt28: number;               // S1_I_DATO_28
  spareInt29: number;               // S1_I_DATO_29
  spareInt30: number;               // S1_I_DATO_30
  spareInt31: number;               // S1_I_DATO_31
  spareInt32: number;               // S1_I_DATO_32
  spareInt33: number;               // S1_I_DATO_33
  spareInt34: number;               // S1_I_DATO_34
  spareInt35: number;               // S1_I_DATO_35
  spareInt36: number;               // S1_I_DATO_36
  spareInt37: number;               // S1_I_DATO_37
  spareInt38: number;               // S1_I_DATO_38
  spareInt39: number;               // S1_I_DATO_39
  spareInt40: number;               // S1_I_DATO_40
  spareInt41: number;               // S1_I_DATO_41
  spareInt42: number;               // S1_I_DATO_42
  spareInt43: number;               // S1_I_DATO_43
  spareInt44: number;               // S1_I_DATO_44
  spareInt45: number;               // S1_I_DATO_45
  spareInt46: number;               // S1_I_DATO_46
  spareInt47: number;               // S1_I_DATO_47
  spareInt48: number;               // S1_I_DATO_48
  spareInt49: number;               // S1_I_DATO_49
  spareInt50: number;               // S1_I_DATO_50
  spareInt51: number;               // S1_I_DATO_51
  spareInt52: number;               // S1_I_DATO_52
  spareInt53: number;               // S1_I_DATO_53
  spareInt54: number;               // S1_I_DATO_54
  spareInt55: number;               // S1_I_DATO_55
  spareInt56: number;               // S1_I_DATO_56
  materialInputWeight: number;      // S1_I_DATO_57
  materialOutputWeight: number;     // S1_I_DATO_58
  selectedCycle: number;            // S1_I_DATO_59
  currentPhase: number;             // S1_I_DATO_60
  machineStatus: number;            // S1_I_DATO_61
  spareInt62: number;               // S1_I_DATO_62
  spareInt63: number;               // S1_I_DATO_63
  spareInt64: number;               // S1_I_DATO_64
  spareInt65: number;               // S1_I_DATO_65
  spareInt66: number;               // S1_I_DATO_66
  spareInt67: number;               // S1_I_DATO_67
  spareInt68: number;               // S1_I_DATO_68
  spareInt69: number;               // S1_I_DATO_69
  spareInt70: number;               // S1_I_DATO_70
  cycleStatus: number;              // S1_I_DATO_71 (V03 — integer verdict, decoded via decodeCycleStatus())
  container: number;                // S1_I_DATO_72 (V03 — bidoni count)

  // --- DINT fields (S1_DI_DATO_1, S1_DI_DATO_2) — 32-bit signed ---
  completedCycles: number;          // S1_DI_DATO_1
  spareDint01: number;              // S1_DI_DATO_2

  // --- STRING[20] fields (S1_S_DATO_1 through S1_S_DATO_5) ---
  user: string;                     // S1_S_DATO_1
  supervisor: string;               // S1_S_DATO_2
  orderNumber: string;              // S1_S_DATO_3
  serialNumber: string;             // S1_S_DATO_4
  spareString01: string;            // S1_S_DATO_5

  // --- REAL fields (S1_R_DATO_1 through S1_R_DATO_15) — 32-bit float (V03) ---
  energyConsumption: number;        // S1_R_DATO_1
  rmsCurrL1: number;                // S1_R_DATO_2
  rmsCurrL2: number;                // S1_R_DATO_3
  rmsCurrL3: number;                // S1_R_DATO_4
  rmsCurrN: number;                 // S1_R_DATO_5
  spareReal01: number;              // S1_R_DATO_6  (V03: rebound from pos 7 — was waterConsumption slot in V01)
  lineVoltL1L2: number;             // S1_R_DATO_7  (V03 NEW — L1-L2 V RMS)
  lineVoltL2L3: number;             // S1_R_DATO_8  (V03 NEW — L2-L3 V RMS)
  lineVoltL3L1: number;             // S1_R_DATO_9  (V03 NEW — L3-L1 V RMS)
  lineNeutralVoltL1: number;        // S1_R_DATO_10 (V03 NEW — VL1-N)
  lineNeutralVoltL2: number;        // S1_R_DATO_11 (V03 NEW — VL2-N)
  lineNeutralVoltL3: number;        // S1_R_DATO_12 (V03 NEW — VL3-N)
  pfTotal: number;                  // S1_R_DATO_13 (V03 NEW — PF total MSW)
  waterConsumption: number;         // S1_R_DATO_14 (V03: rebound from pos 6)
  spareReal02: number;              // S1_R_DATO_15 (V03 NEW)

  // --- BYTE fields (S1_B_DATO_1 through S1_B_DATO_6) — 8-bit unsigned ---
  thermoLeftLowSel: number;         // S1_B_DATO_1
  thermoLeftMedSel: number;         // S1_B_DATO_2
  thermoLeftHighSel: number;        // S1_B_DATO_3
  thermoRightLowSel: number;       // S1_B_DATO_4
  thermoRightMedSel: number;       // S1_B_DATO_5
  thermoRightHighSel: number;      // S1_B_DATO_6
}

export const MachineSnapshotSchema = z.object({
  // INT fields
  thermoLeftLower: z.int(),
  thermoLeftMedium: z.int(),
  thermoLeftUpper: z.int(),
  thermoRightLower: z.int(),
  thermoRightMedium: z.int(),
  thermoRightUpper: z.int(),
  thermoLeftHighLower: z.int(),
  thermoLeftHighMedium: z.int(),
  thermoLeftHighUpper: z.int(),
  thermoRightHighLower: z.int(),
  garbageTemp: z.int(),
  holdingTempSetpoint: z.int(),
  chamberPressure: z.int(),
  mainMotorSpeed: z.int(),
  mainMotorTorque: z.int(),
  mainMotorCurrent: z.int(),
  vacuumPumpSpeed01: z.int(),
  vacuumPumpSpeed02: z.int(),
  spareInt19: z.int(),
  spareInt20: z.int(),
  spareInt21: z.int(),
  spareInt22: z.int(),
  spareInt23: z.int(),
  spareInt24: z.int(),
  spareInt25: z.int(),
  spareInt26: z.int(),
  spareInt27: z.int(),
  spareInt28: z.int(),
  spareInt29: z.int(),
  spareInt30: z.int(),
  spareInt31: z.int(),
  spareInt32: z.int(),
  spareInt33: z.int(),
  spareInt34: z.int(),
  spareInt35: z.int(),
  spareInt36: z.int(),
  spareInt37: z.int(),
  spareInt38: z.int(),
  spareInt39: z.int(),
  spareInt40: z.int(),
  spareInt41: z.int(),
  spareInt42: z.int(),
  spareInt43: z.int(),
  spareInt44: z.int(),
  spareInt45: z.int(),
  spareInt46: z.int(),
  spareInt47: z.int(),
  spareInt48: z.int(),
  spareInt49: z.int(),
  spareInt50: z.int(),
  spareInt51: z.int(),
  spareInt52: z.int(),
  spareInt53: z.int(),
  spareInt54: z.int(),
  spareInt55: z.int(),
  spareInt56: z.int(),
  materialInputWeight: z.int(),
  materialOutputWeight: z.int(),
  selectedCycle: z.int(),
  currentPhase: z.int(),
  machineStatus: z.int(),
  spareInt62: z.int(),
  spareInt63: z.int(),
  spareInt64: z.int(),
  spareInt65: z.int(),
  spareInt66: z.int(),
  spareInt67: z.int(),
  spareInt68: z.int(),
  spareInt69: z.int(),
  spareInt70: z.int(),
  cycleStatus: z.int(),
  container: z.int(),
  // DINT fields
  completedCycles: z.int(),
  spareDint01: z.int(),
  // STRING fields
  user: z.string().max(20),
  supervisor: z.string().max(20),
  orderNumber: z.string().max(20),
  serialNumber: z.string().max(20),
  spareString01: z.string().max(20),
  // REAL fields (V03 — 15 fields, S1_R_DATO_1..15)
  energyConsumption: z.number(),
  rmsCurrL1: z.number(),
  rmsCurrL2: z.number(),
  rmsCurrL3: z.number(),
  rmsCurrN: z.number(),
  spareReal01: z.number(),
  lineVoltL1L2: z.number(),
  lineVoltL2L3: z.number(),
  lineVoltL3L1: z.number(),
  lineNeutralVoltL1: z.number(),
  lineNeutralVoltL2: z.number(),
  lineNeutralVoltL3: z.number(),
  pfTotal: z.number(),
  waterConsumption: z.number(),
  spareReal02: z.number(),
  // BYTE fields
  thermoLeftLowSel: z.int().min(0).max(255),
  thermoLeftMedSel: z.int().min(0).max(255),
  thermoLeftHighSel: z.int().min(0).max(255),
  thermoRightLowSel: z.int().min(0).max(255),
  thermoRightMedSel: z.int().min(0).max(255),
  thermoRightHighSel: z.int().min(0).max(255),
});

/** Fields visible to Client-role users (Salvataggio Login Cliente = x) */
export const CLIENT_VISIBLE_FIELDS = [
  'garbageTemp',
  'chamberPressure',
  'mainMotorSpeed',
  'mainMotorCurrent',
  'vacuumPumpSpeed01',
  'materialInputWeight',
  'materialOutputWeight',
  'selectedCycle',
  'currentPhase',
  'machineStatus',
  'completedCycles',
  'user',
  'supervisor',
  'orderNumber',
  'serialNumber',
  'spareString01',
  'energyConsumption',
  'waterConsumption',
  'cycleStatus',
  'container',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;

/** Fields visible to WPT-role users (all Salvataggio Login Wpt = x) */
export const WPT_VISIBLE_FIELDS = [
  ...CLIENT_VISIBLE_FIELDS,
  'thermoLeftLower',
  'thermoLeftMedium',
  'thermoLeftUpper',
  'thermoRightLower',
  'thermoRightMedium',
  'thermoRightUpper',
  'thermoLeftHighLower',
  'thermoLeftHighMedium',
  'thermoLeftHighUpper',
  'thermoRightHighLower',
  'holdingTempSetpoint',
  'mainMotorTorque',
  'vacuumPumpSpeed02',
  'spareInt19', 'spareInt20', 'spareInt21', 'spareInt22', 'spareInt23',
  'spareInt24', 'spareInt25', 'spareInt26', 'spareInt27', 'spareInt28',
  'spareInt29', 'spareInt30', 'spareInt31', 'spareInt32', 'spareInt33',
  'spareInt34', 'spareInt35', 'spareInt36', 'spareInt37', 'spareInt38',
  'spareInt39', 'spareInt40', 'spareInt41', 'spareInt42', 'spareInt43',
  'spareInt44', 'spareInt45', 'spareInt46', 'spareInt47', 'spareInt48',
  'spareInt49', 'spareInt50', 'spareInt51', 'spareInt52', 'spareInt53',
  'spareInt54', 'spareInt55', 'spareInt56',
  'rmsCurrL1',
  'rmsCurrL2',
  'rmsCurrL3',
  'rmsCurrN',
  'spareReal01',
  'lineVoltL1L2',
  'lineVoltL2L3',
  'lineVoltL3L1',
  'lineNeutralVoltL1',
  'lineNeutralVoltL2',
  'lineNeutralVoltL3',
  'pfTotal',
  'thermoLeftLowSel',
  'thermoLeftMedSel',
  'thermoLeftHighSel',
  'thermoRightLowSel',
  'thermoRightMedSel',
  'thermoRightHighSel',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;

/** Dashboard gauge fields (gauge=x in Mappatura) */
export const GAUGE_FIELDS = [
  'garbageTemp',
  'chamberPressure',
  'mainMotorSpeed',
  'vacuumPumpSpeed01',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;

/** Dashboard text display fields (text field=x in Mappatura) */
export const TEXT_FIELDS = [
  'materialInputWeight',
  'selectedCycle',
  'currentPhase',
  'machineStatus',
  'completedCycles',
  'user',
  'supervisor',
  'orderNumber',
  'serialNumber',
  'spareString01',
] as const satisfies ReadonlyArray<keyof IMachineSnapshot>;
