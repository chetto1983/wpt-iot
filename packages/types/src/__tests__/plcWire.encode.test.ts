import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAlarmPacket,
  buildMachineDataPacket,
  parseAlarmWords,
  parseMachineData,
  setPlcEndian,
  type PlcEndian,
} from '../plc-wire/index.js';
import { buildTestMachineBuffer } from './fixtures/plcPackets.js';

const ENDIANS: PlcEndian[] = ['le', 'be'];

function fixtureSnapshot(): ReturnType<typeof parseMachineData> {
  setPlcEndian('be'); // the fixture buffer is Big-Endian
  return parseMachineData(buildTestMachineBuffer());
}

beforeEach(() => setPlcEndian('le'));

describe('buildMachineDataPacket', () => {
  it('emits the real PLC 328-byte frame: 326-byte payload + all-zero trailer', () => {
    const frame = buildMachineDataPacket(fixtureSnapshot());
    expect(frame.length).toBe(328);
    expect([frame[326], frame[327]]).toEqual([0, 0]);
  });

  it.each(ENDIANS)('round-trips through parseMachineData (%s)', (endian) => {
    const snapshot = fixtureSnapshot();
    setPlcEndian(endian);
    expect(parseMachineData(buildMachineDataPacket(snapshot))).toEqual(snapshot);
  });

  // Literal offsets from the 2026-04-08 AC500 capture, not from the layout
  // table, so a wrong table cannot pass by agreeing with itself.
  it('places fields at the measured CODESYS V2.3 offsets', () => {
    const snapshot = fixtureSnapshot();
    setPlcEndian('be');
    const frame = buildMachineDataPacket(snapshot);
    const str = (at: number): string => frame.toString('ascii', at, at + 21).split('\0', 1)[0] ?? '';

    expect(frame.readInt16BE(140)).toBe(snapshot.cycleStatus);
    expect(frame.readInt32BE(144)).toBe(snapshot.completedCycles);
    expect([152, 173, 194, 215, 236].map(str)).toEqual([
      snapshot.user, snapshot.supervisor, snapshot.orderNumber, snapshot.serialNumber, snapshot.spareString01,
    ]);
    expect([frame[256], frame[257], frame[258], frame[259]]).toEqual([0, 0, 0, 0]);
    expect(frame.readFloatBE(260)).toBeCloseTo(snapshot.energyConsumption, 3);
    expect(frame.readFloatBE(316)).toBeCloseTo(snapshot.spareReal02, 3);
    expect(frame.readUInt8(320)).toBe(snapshot.thermoLeftLowSel);
    expect(frame.readUInt8(325)).toBe(snapshot.thermoRightHighSel);
  });

  it('writes the byte order selected by setPlcEndian', () => {
    const snapshot = fixtureSnapshot();
    setPlcEndian('le');
    const frame = buildMachineDataPacket(snapshot);
    expect(frame.readInt16LE(0)).toBe(snapshot.thermoLeftLower);
    expect(frame.readFloatLE(260)).toBeCloseTo(snapshot.energyConsumption, 3);
  });
});

describe('buildAlarmPacket', () => {
  it.each(ENDIANS)('emits 40 words that round-trip with bit 15 set (%s)', (endian) => {
    setPlcEndian(endian);
    const words = Array.from({ length: 40 }, (_, i) => (i === 0 ? 0x8001 : i));
    const packet = buildAlarmPacket({ words });
    expect(packet.length).toBe(80);
    expect(parseAlarmWords(packet).words.map((w) => w & 0xffff)).toEqual(words);
  });
});
