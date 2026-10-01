import type { IMachineSnapshot } from '../machine.js';

/**
 * V03 PLC wire layout — the single source for the backend parser and the PLC
 * simulator. `Mappatura_WPT_IOT_V03.xlsx` is the authority for field order;
 * slot sizes and alignment below are the empirical CODESYS V2.3 corrections
 * measured 2026-04-08 against the real ABB AC500 (192.168.0.10), which the
 * xlsx does not document.
 */

/**
 * CODESYS V2.3 STRING[N] allocates N+1 bytes — N content bytes plus a NUL
 * terminator — so STRING[20] is 21 bytes on the wire. A tcpdump of a real
 * 9090 frame showed string starts at 152, 173, 194, 215, 236.
 */
export const PLC_STRING_SLOT_BYTES = 21;

/** Max content characters in a STRING[20] slot. */
export const PLC_STRING_MAX_CHARS = 20;

/**
 * The AC500 compiler aligns REAL on a 4-byte boundary: the STRING block ends
 * at byte 257 (exclusive), so 3 NUL bytes sit at [257..259] and REAL starts
 * at 260. Without the skip the REAL block decodes as garbage IEEE 754
 * (pf_total = 1.51e+23); with it the voltages read 400/400/400/230/230/230.
 */
export const MACHINE_STRING_REAL_PAD_BYTES = 3;

/** 72 INT, S1_I_DATO_1..72, offsets 0..143. */
export const MACHINE_INT_FIELDS: readonly (keyof IMachineSnapshot)[] = [
  'thermoLeftLower', 'thermoLeftMedium', 'thermoLeftUpper',
  'thermoRightLower', 'thermoRightMedium', 'thermoRightUpper',
  'thermoLeftHighLower', 'thermoLeftHighMedium', 'thermoLeftHighUpper',
  'thermoRightHighLower', 'garbageTemp', 'holdingTempSetpoint',
  'chamberPressure', 'mainMotorSpeed', 'mainMotorTorque', 'mainMotorCurrent',
  'vacuumPumpSpeed01', 'vacuumPumpSpeed02',
  'spareInt19', 'spareInt20', 'spareInt21', 'spareInt22', 'spareInt23',
  'spareInt24', 'spareInt25', 'spareInt26', 'spareInt27', 'spareInt28',
  'spareInt29', 'spareInt30', 'spareInt31', 'spareInt32', 'spareInt33',
  'spareInt34', 'spareInt35', 'spareInt36', 'spareInt37', 'spareInt38',
  'spareInt39', 'spareInt40', 'spareInt41', 'spareInt42', 'spareInt43',
  'spareInt44', 'spareInt45', 'spareInt46', 'spareInt47', 'spareInt48',
  'spareInt49', 'spareInt50', 'spareInt51', 'spareInt52', 'spareInt53',
  'spareInt54', 'spareInt55', 'spareInt56',
  // S1_I_DATO_57 is a legacy slot kept for offsets: the PLC delivers the
  // material input weight in Spare_R_02 (S1_R_DATO_15).
  'materialInputWeight',
  'materialOutputWeight', 'selectedCycle', 'currentPhase', 'machineStatus',
  'spareInt62', 'spareInt63', 'spareInt64', 'spareInt65', 'spareInt66',
  'spareInt67', 'spareInt68', 'spareInt69', 'spareInt70',
  'cycleStatus', 'container',
];

/** 2 DINT, S1_DI_DATO_1..2, offsets 144..151. */
export const MACHINE_DINT_FIELDS: readonly (keyof IMachineSnapshot)[] = [
  'completedCycles', 'spareDint01',
];

/** 5 STRING[20], S1_S_DATO_1..5, 21-byte slots at offsets 152..256. */
export const MACHINE_STRING_FIELDS: readonly (keyof IMachineSnapshot)[] = [
  'user', 'supervisor', 'orderNumber', 'serialNumber', 'spareString01',
];

/** 15 REAL, S1_R_DATO_1..15, offsets 260..319 (after the PAD). */
export const MACHINE_REAL_FIELDS: readonly (keyof IMachineSnapshot)[] = [
  'energyConsumption', 'rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3', 'rmsCurrN',
  'spareReal01',
  'lineVoltL1L2', 'lineVoltL2L3', 'lineVoltL3L1',
  'lineNeutralVoltL1', 'lineNeutralVoltL2', 'lineNeutralVoltL3',
  'pfTotal', 'waterConsumption', 'spareReal02',
];

/** 6 BYTE, S1_B_DATO_1..6, offsets 320..325. */
export const MACHINE_BYTE_FIELDS: readonly (keyof IMachineSnapshot)[] = [
  'thermoLeftLowSel', 'thermoLeftMedSel', 'thermoLeftHighSel',
  'thermoRightLowSel', 'thermoRightMedSel', 'thermoRightHighSel',
];

/**
 * Machine data payload (9090, PLC -> IoT):
 * 72 INT (144) + 2 DINT (8) + 5 STRING (105) + PAD (3) + 15 REAL (60) + 6 BYTE (6).
 */
export const MACHINE_PACKET_SIZE = 326;

/**
 * The real PLC sends 328-byte frames; bytes [326..327] are an unidentified
 * all-zero trailer in every captured sample. Parsers read 326 and ignore it.
 */
export const MACHINE_FRAME_SIZE = 328;

/** Alarm packet (9091): 40 INT16 words, 16 alarm bits each. */
export const ALARM_WORD_COUNT = 40;
export const ALARM_PACKET_SIZE = ALARM_WORD_COUNT * 2;

/** RFID user slots on the PLC. */
export const RFID_USER_SLOTS = 48;

/**
 * User data packet (9092, both directions):
 * 48 names (48 x 21 = 1008) + 48 groups + 48 enabled = 1104 bytes. A tcpdump
 * of a 9092 READ showed names at 0, 21, 42, 63. The xlsx's 1056 is wrong.
 * Enable polarity is 1 = enabled, 0 = disabled (the xlsx's `0:enable` is wrong).
 */
export const USER_DATA_PACKET_SIZE = 1104;
export const USER_GROUPS_OFFSET = RFID_USER_SLOTS * PLC_STRING_SLOT_BYTES;
export const USER_ENABLED_OFFSET = USER_GROUPS_OFFSET + RFID_USER_SLOTS;

/**
 * Job data packet (9090, IoT -> PLC): 4 STRING[20] (84) + 6 INT (12) = 96.
 * The xlsx's 92 is wrong: the real PLC silently discarded 92-byte writes
 * (2026-04-08). 84 ends on a 2-byte boundary, so no pad before the INTs.
 */
export const JOB_DATA_PACKET_SIZE = 96;
export const JOB_INT_OFFSET = 4 * PLC_STRING_SLOT_BYTES;
