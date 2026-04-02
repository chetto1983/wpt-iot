import type { IMachineSnapshot, IAlarmWords, IRfidUser, IJobData, RfidUserGroup } from '@wpt/types';
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
  'spareInt71',            // S1_I_DATO_71  offset 140
  'spareInt72',            // S1_I_DATO_72  offset 142
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

const REAL_FIELDS: (keyof IMachineSnapshot)[] = [
  'energyConsumption', // S1_R_DATO_1  offset 252
  'rmsCurrL1',         // S1_R_DATO_2  offset 256
  'rmsCurrL2',         // S1_R_DATO_3  offset 260
  'rmsCurrL3',         // S1_R_DATO_4  offset 264
  'rmsCurrN',          // S1_R_DATO_5  offset 268
  'waterConsumption',  // S1_R_DATO_6  offset 272
  'spareReal01',       // S1_R_DATO_7  offset 276
];

const BYTE_FIELDS: (keyof IMachineSnapshot)[] = [
  'thermoLeftLowSel',   // S1_B_DATO_1  offset 280
  'thermoLeftMedSel',   // S1_B_DATO_2  offset 281
  'thermoLeftHighSel',  // S1_B_DATO_3  offset 282
  'thermoRightLowSel',  // S1_B_DATO_4  offset 283
  'thermoRightMedSel',  // S1_B_DATO_5  offset 284
  'thermoRightHighSel', // S1_B_DATO_6  offset 285
];

/**
 * Parse a 286-byte machine data packet (port 9090) into a typed IMachineSnapshot.
 * Layout: 72 INT (144B) + 2 DINT (8B) + 5 STRING[20] (100B) + 7 REAL (28B) + 6 BYTE (6B)
 * All multi-byte values are Big Endian.
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

  // 2 DINT fields -- Big Endian 32-bit signed
  for (const field of DINT_FIELDS) {
    snapshot[field] = buf.readInt32BE(offset);
    offset += 4;
  }

  // 5 STRING[20] fields -- ASCII, null-stripped
  for (const field of STRING_FIELDS) {
    snapshot[field] = buf.toString('ascii', offset, offset + 20).replace(/\0+$/, '');
    offset += 20;
  }

  // 7 REAL fields -- Big Endian 32-bit float
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
 * Parse a 1056-byte user data packet (port 9092) into 48 IRfidUser objects.
 * Layout: 48 names (960B) + 48 group bytes (48B) + 48 enabled bytes (48B)
 * INVERTED LOGIC for enabled: PLC uses 0=enabled, 1=disabled.
 */
export function parseUserData(buf: Buffer): IRfidUser[] {
  if (buf.length < USER_DATA_PACKET_SIZE) {
    throw new Error(`User data packet too short: ${buf.length} bytes (expected >= ${USER_DATA_PACKET_SIZE})`);
  }

  const users: IRfidUser[] = [];
  for (let i = 0; i < 48; i++) {
    const name = buf.toString('ascii', i * 20, (i + 1) * 20).replace(/\0+$/, '');
    const group = buf.readUInt8(960 + i) as RfidUserGroup;
    const enabledByte = buf.readUInt8(1008 + i);
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
 * Parse an 88-byte job data packet (port 9090 during handshake) into IJobData.
 * Layout: 4 STRING[20] (80B) + 4 INT (8B)
 * The 4th string (offset 60-79) is spare and discarded.
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
  };
}

/**
 * Build a 1056-byte user data write packet for port 9092.
 * Mirror of simulator's buildUserDataPacket.
 * Layout: 48 names (960B) + 48 group bytes (48B) + 48 enabled bytes (48B)
 * INVERTED LOGIC for enabled: writes 0 for enabled=true, 1 for enabled=false.
 */
export function buildUserWritePacket(users: IRfidUser[]): Buffer {
  const buf = Buffer.alloc(USER_DATA_PACKET_SIZE);

  // Offset 0-959: Names (48 x 20 bytes ASCII null-padded)
  for (let i = 0; i < 48; i++) {
    const user = users[i];
    const name = user ? user.name.slice(0, 20).padEnd(20, '\0') : '\0'.repeat(20);
    buf.write(name, i * 20, 20, 'ascii');
  }

  // Offset 960-1007: Group bytes
  for (let i = 0; i < 48; i++) {
    const user = users[i];
    buf.writeUInt8(user ? user.group : 0, 960 + i);
  }

  // Offset 1008-1055: Enabled bytes (inverted: true->0, false->1)
  for (let i = 0; i < 48; i++) {
    const user = users[i];
    buf.writeUInt8(user && user.enabled ? 0 : 1, 1008 + i);
  }

  return buf;
}

/**
 * Build an 88-byte job data write packet for port 9090.
 * Mirror of simulator's buildJobReadPacket.
 * Layout: 4 STRING[20] (80B) + 4 INT (8B)
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

  // 4 INT fields
  buf.writeInt16BE(job.remoteJobEnable, offset); offset += 2;
  buf.writeInt16BE(job.maintenanceRequest, offset); offset += 2;
  buf.writeInt16BE(job.remoteCycleSelection, offset); offset += 2;
  buf.writeInt16BE(job.cycleType, offset);

  return buf;
}
