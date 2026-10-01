import type { IMachineSnapshot } from '../machine.js';
import type { IAlarmWords } from '../alarms.js';
import type { IRfidUser } from '../users.js';
import type { IJobData } from '../jobs.js';
import type { IPlcConfig } from '../plc.js';
import type { RfidUserGroup } from '../enums.js';
import { decodeCycleStatus } from '../cycleStatus.js';
import {
  ALARM_PACKET_SIZE,
  ALARM_WORD_COUNT,
  JOB_DATA_PACKET_SIZE,
  JOB_INT_OFFSET,
  MACHINE_BYTE_FIELDS,
  MACHINE_DINT_FIELDS,
  MACHINE_FRAME_SIZE,
  MACHINE_INT_FIELDS,
  MACHINE_PACKET_SIZE,
  MACHINE_REAL_FIELDS,
  MACHINE_STRING_FIELDS,
  MACHINE_STRING_REAL_PAD_BYTES,
  PLC_STRING_MAX_CHARS,
  PLC_STRING_SLOT_BYTES,
  RFID_USER_SLOTS,
  USER_DATA_PACKET_SIZE,
  USER_ENABLED_OFFSET,
  USER_GROUPS_OFFSET,
} from './layout.js';

// Byte order is DETERMINISTIC by protocol version — V2 mapping = Big-Endian,
// V3 mapping = Little-Endian — so it is a config value, never auto-detected.
// The real ABB AC500 in the field is Little-Endian (V3). One module-level
// value drives every multi-byte field in both directions so a process stays
// internally consistent; the backend sets it from plc_config.endian (live on
// PUT /api/plc/config), the simulator from its own env.
export type PlcEndian = IPlcConfig['endian'];

let plcEndian: PlcEndian = 'le';

/** Set the byte order used to decode/encode every multi-byte PLC field. */
export function setPlcEndian(e: PlcEndian): void {
  plcEndian = e;
}

/** Active byte order; `source` is always 'config' (surfaced by /api/health). */
export function getCurrentPlcEndian(): { endian: PlcEndian; source: 'config' } {
  return { endian: plcEndian, source: 'config' as const };
}

const r16 = (b: Buffer, o: number, e: PlcEndian): number => (e === 'le' ? b.readInt16LE(o) : b.readInt16BE(o));
const r32 = (b: Buffer, o: number, e: PlcEndian): number => (e === 'le' ? b.readInt32LE(o) : b.readInt32BE(o));
const rF = (b: Buffer, o: number, e: PlcEndian): number => (e === 'le' ? b.readFloatLE(o) : b.readFloatBE(o));

function w16(b: Buffer, v: number, o: number, e: PlcEndian): void {
  if (e === 'le') b.writeInt16LE(v, o);
  else b.writeInt16BE(v, o);
}

function w32(b: Buffer, v: number, o: number, e: PlcEndian): void {
  if (e === 'le') b.writeInt32LE(v, o);
  else b.writeInt32BE(v, o);
}

function wF(b: Buffer, v: number, o: number, e: PlcEndian): void {
  if (e === 'le') b.writeFloatLE(v, o);
  else b.writeFloatBE(v, o);
}

/** STRING[20] slot content up to the first NUL (CODESYS terminator). */
function readPlcString(buf: Buffer, offset: number): string {
  return buf.toString('ascii', offset, offset + PLC_STRING_SLOT_BYTES).split('\0', 1)[0] ?? '';
}

/** Write at most 20 chars; the zero-filled buffer supplies NUL terminator + padding. */
function writePlcString(buf: Buffer, value: string, offset: number): void {
  buf.write(value.slice(0, PLC_STRING_MAX_CHARS), offset, 'ascii');
}

function assertLength(buf: Buffer, min: number, what: string): void {
  if (buf.length < min) {
    throw new Error(`${what} packet too short: ${buf.length} bytes (expected >= ${min})`);
  }
}

/**
 * Parse a machine data packet (port 9090). Reads the 326-byte payload; the
 * real PLC's 328-byte frame passes the length check and its trailer is ignored.
 */
export function parseMachineData(buf: Buffer): IMachineSnapshot {
  assertLength(buf, MACHINE_PACKET_SIZE, 'Machine data');
  const endian = plcEndian;
  const snapshot: Record<string, number | string> = {};
  let offset = 0;

  for (const field of MACHINE_INT_FIELDS) {
    snapshot[field] = r16(buf, offset, endian);
    offset += 2;
  }

  // PROT-V03-08: surface reserved cycle_status values so firmware drift is noticed.
  const cs = snapshot['cycleStatus'] as number;
  if (cs >= 5) {
    const decoded = decodeCycleStatus(cs);
    console.warn(
      `[parseMachineData] reserved cycle_status value ${cs} (label=${decoded.label}) — update cycleStatus.ts lookup when Paolo provides label`,
    );
  }

  for (const field of MACHINE_DINT_FIELDS) {
    snapshot[field] = r32(buf, offset, endian);
    offset += 4;
  }

  for (const field of MACHINE_STRING_FIELDS) {
    snapshot[field] = readPlcString(buf, offset);
    offset += PLC_STRING_SLOT_BYTES;
  }

  offset += MACHINE_STRING_REAL_PAD_BYTES;

  for (const field of MACHINE_REAL_FIELDS) {
    snapshot[field] = rF(buf, offset, endian);
    offset += 4;
  }

  // The PLC delivers the material input weight in Spare_R_02 (S1_R_DATO_15);
  // spareReal02 stays as the raw protocol field, the INT slot only keeps offsets.
  snapshot['materialInputWeight'] = snapshot['spareReal02']!;

  for (const field of MACHINE_BYTE_FIELDS) {
    snapshot[field] = buf.readUInt8(offset);
    offset += 1;
  }

  return snapshot as unknown as IMachineSnapshot;
}

/**
 * Build a machine data frame (port 9090, PLC -> IoT) exactly as the real PLC
 * sends it: the 326-byte payload plus the 2-byte zero trailer. Fields are
 * written verbatim; the inverse of parseMachineData.
 */
export function buildMachineDataPacket(snapshot: IMachineSnapshot): Buffer {
  const buf = Buffer.alloc(MACHINE_FRAME_SIZE);
  const endian = plcEndian;
  const num = (field: keyof IMachineSnapshot): number => snapshot[field] as number;
  let offset = 0;

  for (const field of MACHINE_INT_FIELDS) {
    w16(buf, num(field), offset, endian);
    offset += 2;
  }
  for (const field of MACHINE_DINT_FIELDS) {
    w32(buf, num(field), offset, endian);
    offset += 4;
  }
  for (const field of MACHINE_STRING_FIELDS) {
    writePlcString(buf, snapshot[field] as string, offset);
    offset += PLC_STRING_SLOT_BYTES;
  }
  offset += MACHINE_STRING_REAL_PAD_BYTES;
  for (const field of MACHINE_REAL_FIELDS) {
    wF(buf, num(field), offset, endian);
    offset += 4;
  }
  for (const field of MACHINE_BYTE_FIELDS) {
    buf.writeUInt8(num(field), offset);
    offset += 1;
  }
  return buf;
}

/** Parse an alarm packet (port 9091): 40 signed INT16 words of 16 alarm flags. */
export function parseAlarmWords(buf: Buffer): IAlarmWords {
  assertLength(buf, ALARM_PACKET_SIZE, 'Alarm');
  const endian = plcEndian;
  const words: number[] = [];
  for (let i = 0; i < ALARM_WORD_COUNT; i++) {
    words.push(r16(buf, i * 2, endian));
  }
  return { words };
}

/** Build an alarm packet (port 9091, PLC -> IoT). */
export function buildAlarmPacket(alarms: IAlarmWords): Buffer {
  const buf = Buffer.alloc(ALARM_PACKET_SIZE);
  const endian = plcEndian;
  for (let i = 0; i < ALARM_WORD_COUNT; i++) {
    // Alarm words are bitfields: bit 15 makes a word >= 0x8000, so fold it to
    // the signed INT16 with the same bit pattern the PLC puts on the wire.
    w16(buf, ((alarms.words[i] ?? 0) << 16) >> 16, i * 2, endian);
  }
  return buf;
}

/**
 * Parse a user data packet (port 9092) into 48 IRfidUser objects.
 *
 * Enable polarity is 1 = enabled, 0 = disabled in BOTH directions — confirmed
 * by Paolo on 2026-04-08 against the real AC500 (a fresh PLC read all 48
 * enabled bytes = 0 = all disabled). The xlsx's `0:enable/1:disable` is WRONG:
 * the xlsx is the authority for layout, not for enum semantics.
 */
export function parseUserData(buf: Buffer): IRfidUser[] {
  assertLength(buf, USER_DATA_PACKET_SIZE, 'User data');
  const users: IRfidUser[] = [];
  for (let i = 0; i < RFID_USER_SLOTS; i++) {
    users.push({
      tagId: i + 1,
      name: readPlcString(buf, i * PLC_STRING_SLOT_BYTES),
      group: buf.readUInt8(USER_GROUPS_OFFSET + i) as RfidUserGroup,
      enabled: buf.readUInt8(USER_ENABLED_OFFSET + i) === 1,
    });
  }
  return users;
}

/** Build a user data packet (port 9092, same layout in both directions). */
export function buildUserDataPacket(users: IRfidUser[]): Buffer {
  const buf = Buffer.alloc(USER_DATA_PACKET_SIZE);
  for (let i = 0; i < RFID_USER_SLOTS; i++) {
    const user = users[i];
    if (!user) continue;
    writePlcString(buf, user.name, i * PLC_STRING_SLOT_BYTES);
    buf.writeUInt8(user.group, USER_GROUPS_OFFSET + i);
    buf.writeUInt8(user.enabled ? 1 : 0, USER_ENABLED_OFFSET + i);
  }
  return buf;
}

/**
 * Parse a job data packet (port 9090, IoT -> PLC write). The 4th string slot
 * is spare and discarded. The real PLC never sends job data back: job values
 * are read from the machine data broadcast (S1_S_DATO_2..4).
 */
export function parseJobData(buf: Buffer): IJobData {
  assertLength(buf, JOB_DATA_PACKET_SIZE, 'Job data');
  const endian = plcEndian;
  const int = (i: number): number => r16(buf, JOB_INT_OFFSET + i * 2, endian);
  return {
    supervisor: readPlcString(buf, 0),
    orderNumber: readPlcString(buf, PLC_STRING_SLOT_BYTES),
    serialNumber: readPlcString(buf, 2 * PLC_STRING_SLOT_BYTES),
    remoteJobEnable: int(0),
    maintenanceRequest: int(1),
    remoteCycleSelection: int(2),
    cycleType: int(3),
    spareInt02: int(4),
    spareInt03: int(5),
  };
}

/** Build a job data write packet (port 9090, IoT -> PLC). */
export function buildJobWritePacket(job: IJobData): Buffer {
  const buf = Buffer.alloc(JOB_DATA_PACKET_SIZE);
  const strings = [job.supervisor, job.orderNumber, job.serialNumber, ''];
  strings.forEach((s, i) => writePlcString(buf, s, i * PLC_STRING_SLOT_BYTES));
  const endian = plcEndian;
  const ints = [
    job.remoteJobEnable, job.maintenanceRequest, job.remoteCycleSelection,
    job.cycleType, job.spareInt02, job.spareInt03,
  ];
  ints.forEach((v, i) => w16(buf, v, JOB_INT_OFFSET + i * 2, endian));
  return buf;
}
