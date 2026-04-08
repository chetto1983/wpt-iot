import type { IMachineSnapshot, IAlarmWords, IRfidUser, IJobData, RfidUserGroup } from '@wpt/types';
import { decodeCycleStatus } from '@wpt/types';
import {
  MACHINE_PACKET_SIZE,
  ALARM_PACKET_SIZE,
  USER_DATA_PACKET_SIZE,
  JOB_DATA_PACKET_SIZE,
} from './packetSizes.js';

/**
 * All 72 INT field names in order matching S1_I_DATO_1 through S1_I_DATO_72.
 * MUST exactly match the MACHINE_DATA_INT_FIELDS array in the simulator's packetBuilder.ts.
 */
const MACHINE_DATA_INT_FIELDS: (keyof IMachineSnapshot)[] = [
  'thermoLeftLower',       // S1_I_DATO_1   offset 0
  'thermoLeftMedium',      // S1_I_DATO_2   offset 2
  'thermoLeftUpper',       // S1_I_DATO_3   offset 4
  'thermoRightLower',      // S1_I_DATO_4   offset 6
  'thermoRightMedium',     // S1_I_DATO_5   offset 8
  'thermoRightUpper',      // S1_I_DATO_6   offset 10
  'thermoLeftHighLower',   // S1_I_DATO_7   offset 12
  'thermoLeftHighMedium',  // S1_I_DATO_8   offset 14
  'thermoLeftHighUpper',   // S1_I_DATO_9   offset 16
  'thermoRightHighLower',  // S1_I_DATO_10  offset 18
  'garbageTemp',           // S1_I_DATO_11  offset 20
  'holdingTempSetpoint',   // S1_I_DATO_12  offset 22
  'chamberPressure',       // S1_I_DATO_13  offset 24
  'mainMotorSpeed',        // S1_I_DATO_14  offset 26
  'mainMotorTorque',       // S1_I_DATO_15  offset 28
  'mainMotorCurrent',      // S1_I_DATO_16  offset 30
  'vacuumPumpSpeed01',     // S1_I_DATO_17  offset 32
  'vacuumPumpSpeed02',     // S1_I_DATO_18  offset 34
  'spareInt19',            // S1_I_DATO_19  offset 36
  'spareInt20',            // S1_I_DATO_20  offset 38
  'spareInt21',            // S1_I_DATO_21  offset 40
  'spareInt22',            // S1_I_DATO_22  offset 42
  'spareInt23',            // S1_I_DATO_23  offset 44
  'spareInt24',            // S1_I_DATO_24  offset 46
  'spareInt25',            // S1_I_DATO_25  offset 48
  'spareInt26',            // S1_I_DATO_26  offset 50
  'spareInt27',            // S1_I_DATO_27  offset 52
  'spareInt28',            // S1_I_DATO_28  offset 54
  'spareInt29',            // S1_I_DATO_29  offset 56
  'spareInt30',            // S1_I_DATO_30  offset 58
  'spareInt31',            // S1_I_DATO_31  offset 60
  'spareInt32',            // S1_I_DATO_32  offset 62
  'spareInt33',            // S1_I_DATO_33  offset 64
  'spareInt34',            // S1_I_DATO_34  offset 66
  'spareInt35',            // S1_I_DATO_35  offset 68
  'spareInt36',            // S1_I_DATO_36  offset 70
  'spareInt37',            // S1_I_DATO_37  offset 72
  'spareInt38',            // S1_I_DATO_38  offset 74
  'spareInt39',            // S1_I_DATO_39  offset 76
  'spareInt40',            // S1_I_DATO_40  offset 78
  'spareInt41',            // S1_I_DATO_41  offset 80
  'spareInt42',            // S1_I_DATO_42  offset 82
  'spareInt43',            // S1_I_DATO_43  offset 84
  'spareInt44',            // S1_I_DATO_44  offset 86
  'spareInt45',            // S1_I_DATO_45  offset 88
  'spareInt46',            // S1_I_DATO_46  offset 90
  'spareInt47',            // S1_I_DATO_47  offset 92
  'spareInt48',            // S1_I_DATO_48  offset 94
  'spareInt49',            // S1_I_DATO_49  offset 96
  'spareInt50',            // S1_I_DATO_50  offset 98
  'spareInt51',            // S1_I_DATO_51  offset 100
  'spareInt52',            // S1_I_DATO_52  offset 102
  'spareInt53',            // S1_I_DATO_53  offset 104
  'spareInt54',            // S1_I_DATO_54  offset 106
  'spareInt55',            // S1_I_DATO_55  offset 108
  'spareInt56',            // S1_I_DATO_56  offset 110
  'materialInputWeight',   // S1_I_DATO_57  offset 112
  'materialOutputWeight',  // S1_I_DATO_58  offset 114
  'selectedCycle',         // S1_I_DATO_59  offset 116
  'currentPhase',          // S1_I_DATO_60  offset 118
  'machineStatus',         // S1_I_DATO_61  offset 120
  'spareInt62',            // S1_I_DATO_62  offset 122
  'spareInt63',            // S1_I_DATO_63  offset 124
  'spareInt64',            // S1_I_DATO_64  offset 126
  'spareInt65',            // S1_I_DATO_65  offset 128
  'spareInt66',            // S1_I_DATO_66  offset 130
  'spareInt67',            // S1_I_DATO_67  offset 132
  'spareInt68',            // S1_I_DATO_68  offset 134
  'spareInt69',            // S1_I_DATO_69  offset 136
  'spareInt70',            // S1_I_DATO_70  offset 138
  'cycleStatus',           // S1_I_DATO_71  offset 140 (V03)
  'container',             // S1_I_DATO_72  offset 142 (V03)
];

const DINT_FIELDS: (keyof IMachineSnapshot)[] = [
  'completedCycles',  // S1_DI_DATO_1  offset 144
  'spareDint01',      // S1_DI_DATO_2  offset 148
];

const STRING_FIELDS: (keyof IMachineSnapshot)[] = [
  'user',             // S1_S_DATO_1   offset 152
  'supervisor',       // S1_S_DATO_2   offset 172
  'orderNumber',      // S1_S_DATO_3   offset 192
  'serialNumber',     // S1_S_DATO_4   offset 212
  'spareString01',    // S1_S_DATO_5   offset 232
];

// Offsets below reflect the real CODESYS V2.3 AC500 wire layout:
//   152..256 = 5 STRING[20] slots (21 bytes each)
//   257..259 = 3 bytes alignment PAD (CODESYS aligns REAL on 4-byte boundary)
//   260..319 = 15 REAL fields (4 bytes each, Big Endian)
//   320..325 = 6 BYTE fields
// See packetSizes.ts MACHINE_PACKET_SIZE comment for the byte-level evidence.
const REAL_FIELDS: (keyof IMachineSnapshot)[] = [
  'energyConsumption',  // S1_R_DATO_1   offset 260
  'rmsCurrL1',          // S1_R_DATO_2   offset 264
  'rmsCurrL2',          // S1_R_DATO_3   offset 268
  'rmsCurrL3',          // S1_R_DATO_4   offset 272
  'rmsCurrN',           // S1_R_DATO_5   offset 276
  'spareReal01',        // S1_R_DATO_6   offset 280 (V03 — was waterConsumption in V01)
  'lineVoltL1L2',       // S1_R_DATO_7   offset 284 (V03 NEW)
  'lineVoltL2L3',       // S1_R_DATO_8   offset 288 (V03 NEW)
  'lineVoltL3L1',       // S1_R_DATO_9   offset 292 (V03 NEW)
  'lineNeutralVoltL1',  // S1_R_DATO_10  offset 296 (V03 NEW)
  'lineNeutralVoltL2',  // S1_R_DATO_11  offset 300 (V03 NEW)
  'lineNeutralVoltL3',  // S1_R_DATO_12  offset 304 (V03 NEW)
  'pfTotal',            // S1_R_DATO_13  offset 308 (V03 NEW)
  'waterConsumption',   // S1_R_DATO_14  offset 312 (V03 — was S1_R_DATO_6 in V01)
  'spareReal02',        // S1_R_DATO_15  offset 316 (V03 NEW)
];

const BYTE_FIELDS: (keyof IMachineSnapshot)[] = [
  'thermoLeftLowSel',   // S1_B_DATO_1  offset 320 (V03)
  'thermoLeftMedSel',   // S1_B_DATO_2  offset 321 (V03)
  'thermoLeftHighSel',  // S1_B_DATO_3  offset 322 (V03)
  'thermoRightLowSel',  // S1_B_DATO_4  offset 323 (V03)
  'thermoRightMedSel',  // S1_B_DATO_5  offset 324 (V03)
  'thermoRightHighSel', // S1_B_DATO_6  offset 325 (V03)
];

/**
 * Parse a 326-byte machine data packet (port 9090, V03) into a typed IMachineSnapshot.
 * Layout: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (105B) + 3 PAD (3B) + 15 REAL (60B) + 6 BYTE (6B) = 326
 * All multi-byte values are Big Endian. The real PLC sends 328-byte frames; bytes [326..327]
 * are an unidentified trailer (all-zero in captured samples) — tolerated by the `< length` check.
 * V03 deltas vs V01: REAL expanded 7->15 (added L1-L2/L2-L3/L3-L1 voltages, L1/L2/L3-N voltages,
 * PF total); waterConsumption moved from S1_R_DATO_6 (offset 272) to S1_R_DATO_14 (offset 312);
 * spareReal01 rebound to S1_R_DATO_6 (offset 280); INT S1_I_DATO_71/72 renamed to cycleStatus/container.
 * 2026-04-08: Added 3-byte alignment pad after STRING block (CODESYS 4-byte REAL alignment),
 * verified against real ABB AC500 hex capture — without this the REAL block decodes as garbage
 * IEEE 754 values (e.g. pf_total = 1.51e+23, line_volt_l1_l2 = -2.27e+33).
 */
export function parseMachineData(buf: Buffer): IMachineSnapshot {
  if (buf.length < MACHINE_PACKET_SIZE) {
    throw new Error(`Machine data packet too short: ${buf.length} bytes (expected >= ${MACHINE_PACKET_SIZE})`);
  }

  const snapshot: Record<string, number | string> = {};
  let offset = 0;

  // 72 INT fields -- Big Endian 16-bit signed
  for (const field of MACHINE_DATA_INT_FIELDS) {
    snapshot[field] = buf.readInt16BE(offset);
    offset += 2;
  }

  // Sanity: WARN on reserved cycle_status values (PROT-V03-08). Phase 19.1 does not
  // yet implement the rising-edge cycle register state machine (v1.2), but we do
  // surface unknown enum values so operators notice firmware drift.
  const cs = snapshot['cycleStatus'] as number;
  if (typeof cs === 'number' && cs >= 5) {
    const decoded = decodeCycleStatus(cs);
    console.warn(
      `[parseMachineData] reserved cycle_status value ${cs} (label=${decoded.label}) — update cycleStatus.ts lookup when Paolo provides label`
    );
  }

  // 2 DINT fields -- Big Endian 32-bit signed
  for (const field of DINT_FIELDS) {
    snapshot[field] = buf.readInt32BE(offset);
    offset += 4;
  }

  // 5 STRING[20] fields -- CODESYS V2.3 STRING[N] occupies N+1 bytes on the wire
  // (N content + NUL terminator), so each slot is 21 bytes, NOT 20. Take content up
  // to the first NUL. Verified empirically against real ABB AC500 PLC on 2026-04-08
  // — see MACHINE_PACKET_SIZE comment in packetSizes.ts for the byte-level evidence.
  for (const field of STRING_FIELDS) {
    const slot = buf.toString('ascii', offset, offset + 21);
    snapshot[field] = slot.split('\0', 1)[0] ?? '';
    offset += 21;
  }

  // 3-byte alignment PAD between STRING block and REAL block.
  // The CODESYS V2.3 AC500 compiler aligns REAL (32-bit float) access on a 4-byte
  // boundary. STRING block ends at byte 256 (152 + 5*21); the next 4-byte aligned
  // offset is 260, so the wire has 3 zero pad bytes at [257..259]. Without this
  // skip, readFloatBE decodes misaligned bytes as garbage IEEE 754 values
  // (e.g. pf_total = 1.51e+23, line_volt_l1_l2 = -2.27e+33). Verified 2026-04-08
  // against the real ABB AC500 hex capture — with the pad the REAL block decodes
  // as textbook 400V/400V/400V/230V/230V/230V/0 for the 7 new V03 three-phase
  // voltage fields. See .planning/debug/artifacts/real-plc-9090-frame-2026-04-08.hex.
  offset += 3;

  // 15 REAL fields -- Big Endian 32-bit float (V03)
  for (const field of REAL_FIELDS) {
    snapshot[field] = buf.readFloatBE(offset);
    offset += 4;
  }

  // 6 BYTE fields -- unsigned 8-bit
  for (const field of BYTE_FIELDS) {
    snapshot[field] = buf.readUInt8(offset);
    offset += 1;
  }

  return snapshot as unknown as IMachineSnapshot;
}

/**
 * Parse an 80-byte alarm packet (port 9091) into IAlarmWords.
 * 40 INT16 words, each 2 bytes Big Endian. Each word contains 16 alarm flags.
 */
export function parseAlarmWords(buf: Buffer): IAlarmWords {
  if (buf.length < ALARM_PACKET_SIZE) {
    throw new Error(`Alarm packet too short: ${buf.length} bytes (expected >= ${ALARM_PACKET_SIZE})`);
  }

  const words: number[] = [];
  for (let i = 0; i < 40; i++) {
    words.push(buf.readInt16BE(i * 2));
  }

  return { words };
}

/**
 * RFID enable polarity (V03 xlsx, PROT-V03-07): 0 = enabled, 1 = disabled, in BOTH directions.
 * Source: Mappatura_WPT_IOT_V03.xlsx sheets `AC500->IOT_9092` and `IOT->AC500_9092` rows 98-145
 * column C, literal text `0:enable/1:disable`. Do NOT flip this. The .EXP file is not authoritative
 * (user directive 2026-04-07). If in doubt, re-parse the xlsx with unzip + xl/sharedStrings.xml.
 */
/**
 * Parse a 1104-byte user data packet (port 9092) into 48 IRfidUser objects.
 * Layout: 48 names (48 x 21 = 1008B) + 48 group bytes (48B) + 48 enabled bytes (48B)
 *
 * STRING[20] is 21 bytes per slot on the wire (CODESYS V2.3: N content + NUL terminator).
 * Verified 2026-04-08 against real ABB AC500 PLC: tcpdump of 9092 READ showed
 * "operatore1" at offset 0, "operatore2" at offset 21, "operatore3" at 42, "operatore4" at 63.
 *
 * INVERTED LOGIC for enabled: PLC uses 0=enabled, 1=disabled.
 */
export function parseUserData(buf: Buffer): IRfidUser[] {
  if (buf.length < USER_DATA_PACKET_SIZE) {
    throw new Error(`User data packet too short: ${buf.length} bytes (expected >= ${USER_DATA_PACKET_SIZE})`);
  }

  const users: IRfidUser[] = [];
  for (let i = 0; i < 48; i++) {
    // 21-byte NAME slot, content up to first NUL (CODESYS string terminator).
    const slot = buf.toString('ascii', i * 21, (i + 1) * 21);
    const name = slot.split('\0', 1)[0] ?? '';
    const group = buf.readUInt8(1008 + i) as RfidUserGroup;     // 48*21 = 1008
    const enabledByte = buf.readUInt8(1056 + i);                // 1008 + 48 = 1056
    users.push({
      tagId: i + 1,
      name,
      group,
      enabled: enabledByte === 0, // Inverted: 0=enabled, 1=disabled
    });
  }

  return users;
}

/**
 * Parse a 92-byte job data packet (port 9090 during handshake, V03) into IJobData.
 * Layout: 4 STRING[20] (80B) + 6 INT (12B) = 92 bytes
 * The 4th string (offset 60-79) is spare and discarded.
 * V03 delta: added R1_I_DATO_5 (spareInt02, offset 88) and R1_I_DATO_6 (spareInt03, offset 90).
 */
export function parseJobData(buf: Buffer): IJobData {
  if (buf.length < JOB_DATA_PACKET_SIZE) {
    throw new Error(`Job data packet too short: ${buf.length} bytes (expected >= ${JOB_DATA_PACKET_SIZE})`);
  }

  return {
    supervisor: buf.toString('ascii', 0, 20).replace(/\0+$/, ''),
    orderNumber: buf.toString('ascii', 20, 40).replace(/\0+$/, ''),
    serialNumber: buf.toString('ascii', 40, 60).replace(/\0+$/, ''),
    // 4th string (offset 60-79) is spare, discarded
    remoteJobEnable: buf.readInt16BE(80),
    maintenanceRequest: buf.readInt16BE(82),
    remoteCycleSelection: buf.readInt16BE(84),
    cycleType: buf.readInt16BE(86),
    spareInt02: buf.readInt16BE(88),  // V03 — R1_I_DATO_5
    spareInt03: buf.readInt16BE(90),  // V03 — R1_I_DATO_6
  };
}

/**
 * RFID enable polarity (V03 xlsx, PROT-V03-07): 0 = enabled, 1 = disabled, in BOTH directions.
 * Source: Mappatura_WPT_IOT_V03.xlsx sheets `AC500->IOT_9092` and `IOT->AC500_9092` rows 98-145
 * column C, literal text `0:enable/1:disable`. Do NOT flip this. The .EXP file is not authoritative
 * (user directive 2026-04-07). If in doubt, re-parse the xlsx with unzip + xl/sharedStrings.xml.
 */
/**
 * Build a 1104-byte user data write packet for port 9092.
 * Layout: 48 names (48 x 21 = 1008B) + 48 group bytes (48B) + 48 enabled bytes (48B)
 *
 * STRING[20] = 21 bytes per slot on the wire (CODESYS V2.3). Each name slot
 * gets at most 20 content chars, followed by NUL terminator + NUL padding
 * to fill the remaining slot bytes. Buffer.alloc zero-fills, so we just
 * write the content at the slot start.
 *
 * INVERTED LOGIC for enabled: writes 0 for enabled=true, 1 for enabled=false.
 */
export function buildUserWritePacket(users: IRfidUser[]): Buffer {
  const buf = Buffer.alloc(USER_DATA_PACKET_SIZE);

  // Offset 0..1007: Names (48 x 21 bytes, content + NUL terminator + NUL padding)
  for (let i = 0; i < 48; i++) {
    const user = users[i];
    const name = user ? user.name.slice(0, 20) : '';
    // Buffer.alloc zero-fills; writing name leaves the rest of the slot as NULs
    buf.write(name, i * 21, Math.min(name.length, 20), 'ascii');
  }

  // Offset 1008..1055: Group bytes
  for (let i = 0; i < 48; i++) {
    const user = users[i];
    buf.writeUInt8(user ? user.group : 0, 1008 + i);
  }

  // Offset 1056..1103: Enabled bytes (inverted: true->0, false->1)
  for (let i = 0; i < 48; i++) {
    const user = users[i];
    buf.writeUInt8(user && user.enabled ? 0 : 1, 1056 + i);
  }

  return buf;
}

/**
 * Build a 92-byte job data write packet for port 9090 (V03).
 * Mirror of simulator's buildJobReadPacket.
 * Layout: 4 STRING[20] (80B) + 6 INT (12B) = 92 bytes
 * TODO(PROT-V03-12, open-accepted risk): The real ABB AC500 PLC firmware may still
 * be at the 88-byte layout. If bench-day Wireshark capture shows the PLC rejects
 * 92-byte writes, fall back to dual-version write (try 92, fall back to 88 on no-ACK).
 */
export function buildJobWritePacket(job: IJobData): Buffer {
  const buf = Buffer.alloc(JOB_DATA_PACKET_SIZE);
  let offset = 0;

  // 4 STRING[20] fields
  const strings = [job.supervisor, job.orderNumber, job.serialNumber, ''];
  for (const str of strings) {
    buf.write(str.slice(0, 20).padEnd(20, '\0'), offset, 20, 'ascii');
    offset += 20;
  }

  // 6 INT fields (V03 — added spareInt02/spareInt03 at offsets 88, 90)
  buf.writeInt16BE(job.remoteJobEnable, offset); offset += 2;
  buf.writeInt16BE(job.maintenanceRequest, offset); offset += 2;
  buf.writeInt16BE(job.remoteCycleSelection, offset); offset += 2;
  buf.writeInt16BE(job.cycleType, offset); offset += 2;
  buf.writeInt16BE(job.spareInt02, offset); offset += 2;
  buf.writeInt16BE(job.spareInt03, offset);

  return buf;
}
