import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseMachineData,
  parseAlarmWords,
  parseUserData,
  parseJobData,
  buildUserWritePacket,
  buildJobWritePacket,
  setPlcEndian,
} from '../udp/parsers.js';
import {
  buildTestMachineBuffer,
  buildTestAlarmBuffer,
  buildTestUserBuffer,
  buildTestJobBuffer,
} from './fixtures/packets.js';
import { RfidUserGroup, CycleType } from '@wpt/types';

// Endianness is now config-driven (default 'le'), and every fixture buffer in
// this suite is Big-Endian. Pin the parser to BE before each case so the
// existing BE-fixture decode assertions still hold. This is the intended
// API-contract adaptation (endianness became explicit), not test-gaming — the
// dedicated 'endianness is config-driven' block below proves BOTH orders.
beforeEach(() => setPlcEndian('be'));

describe('parseMachineData', () => {
  it('decodes all 100 fields from a 326-byte buffer', () => {
    const buf = buildTestMachineBuffer();
    const snapshot = parseMachineData(buf);

    // INT fields
    expect(snapshot.thermoLeftLower).toBe(180);
    expect(snapshot.thermoLeftMedium).toBe(200);
    expect(snapshot.thermoLeftUpper).toBe(220);
    expect(snapshot.thermoRightLower).toBe(170);
    expect(snapshot.thermoRightMedium).toBe(190);
    expect(snapshot.thermoRightUpper).toBe(210);
    expect(snapshot.garbageTemp).toBe(450);
    expect(snapshot.holdingTempSetpoint).toBe(400);
    expect(snapshot.chamberPressure).toBe(-50);
    expect(snapshot.mainMotorSpeed).toBe(1500);
    expect(snapshot.vacuumPumpSpeed01).toBe(2800);
    expect(snapshot.materialInputWeight).toBe(500);
    expect(snapshot.materialOutputWeight).toBe(350);
    expect(snapshot.selectedCycle).toBe(3);
    expect(snapshot.currentPhase).toBe(2);
    expect(snapshot.machineStatus).toBe(3);

    // V03 NEW INT fields
    expect(snapshot.cycleStatus).toBe(2);
    expect(snapshot.container).toBe(13);

    // DINT fields
    expect(snapshot.completedCycles).toBe(42);
    expect(snapshot.spareDint01).toBe(0);

    // STRING fields
    expect(snapshot.user).toBe('Mario');
    expect(snapshot.supervisor).toBe('Luigi');
    expect(snapshot.orderNumber).toBe('ORD-100');
    expect(snapshot.serialNumber).toBe('SN-200');
    expect(snapshot.spareString01).toBe('');

    // REAL fields (V03 — 15 fields, float precision)
    expect(snapshot.energyConsumption).toBeCloseTo(123.45, 1);
    expect(snapshot.rmsCurrL1).toBeCloseTo(10.5, 1);
    expect(snapshot.rmsCurrL2).toBeCloseTo(11.2, 1);
    expect(snapshot.rmsCurrL3).toBeCloseTo(10.8, 1);
    expect(snapshot.rmsCurrN).toBeCloseTo(0.3, 1);
    expect(snapshot.spareReal01).toBe(0); // V03 — was waterConsumption slot in V01
    expect(snapshot.lineVoltL1L2).toBeCloseTo(400.5, 1);
    expect(snapshot.lineVoltL2L3).toBeCloseTo(401.2, 1);
    expect(snapshot.lineVoltL3L1).toBeCloseTo(399.8, 1);
    expect(snapshot.lineNeutralVoltL1).toBeCloseTo(231.1, 1);
    expect(snapshot.lineNeutralVoltL2).toBeCloseTo(232.0, 1);
    expect(snapshot.lineNeutralVoltL3).toBeCloseTo(230.5, 1);
    expect(snapshot.pfTotal).toBeCloseTo(0.92, 2);
    expect(snapshot.waterConsumption).toBeCloseTo(55.7, 1); // NEW offset 304
    expect(snapshot.spareReal02).toBe(0);

    // BYTE fields (V03 offsets 312-317)
    expect(snapshot.thermoLeftLowSel).toBe(1);
    expect(snapshot.thermoLeftMedSel).toBe(0);
    expect(snapshot.thermoLeftHighSel).toBe(1);
    expect(snapshot.thermoRightLowSel).toBe(0);
    expect(snapshot.thermoRightMedSel).toBe(1);
    expect(snapshot.thermoRightHighSel).toBe(0);
  });

  it('throws on buffer shorter than 326 bytes (rejects V01/V02 packets)', () => {
    const shortBuf = Buffer.alloc(318); // V02/pre-V03 318-byte size, now rejected
    expect(() => parseMachineData(shortBuf)).toThrow('too short');
  });
});

describe('parseAlarmWords', () => {
  it('decodes 40 alarm words from an 80-byte buffer', () => {
    const buf = buildTestAlarmBuffer();
    const alarms = parseAlarmWords(buf);

    expect(alarms.words).toHaveLength(40);
    expect(alarms.words[0]).toBe(5);     // bits 0 and 2 set
    // word[1] stored as signed Int16BE for 0x8000 = -32768
    expect(alarms.words[1]).toBe(-32768);
    expect(alarms.words[2]).toBe(0);
    expect(alarms.words[39]).toBe(0);
  });

  it('throws on buffer shorter than 80 bytes', () => {
    const shortBuf = Buffer.alloc(40);
    expect(() => parseAlarmWords(shortBuf)).toThrow('too short');
  });
});

describe('parseUserData', () => {
  it('decodes 48 RFID users from a 1104-byte buffer', () => {
    const buf = buildTestUserBuffer();
    const users = parseUserData(buf);

    expect(users).toHaveLength(48);

    // User 0: enabled byte = 1 -> enabled = true
    // Verified against real ABB AC500 PLC on 2026-04-08 — the V03 xlsx
    // column C annotation `0:enable/1:disable` is WRONG. Real polarity is
    // 0 = disabled, 1 = enabled in BOTH directions.
    expect(users[0]!.tagId).toBe(1);
    expect(users[0]!.name).toBe('Operator1');
    expect(users[0]!.group).toBe(RfidUserGroup.OPERATOR);
    expect(users[0]!.enabled).toBe(true);

    // User 1: enabled byte = 0 -> enabled = false
    expect(users[1]!.tagId).toBe(2);
    expect(users[1]!.name).toBe('Maint1');
    expect(users[1]!.group).toBe(RfidUserGroup.MAINTENANCE);
    expect(users[1]!.enabled).toBe(false);

    // User 2: empty name, disabled
    expect(users[2]!.tagId).toBe(3);
    expect(users[2]!.name).toBe('');
    expect(users[2]!.group).toBe(RfidUserGroup.OPERATOR);
    expect(users[2]!.enabled).toBe(false);
  });

  it('throws on buffer shorter than 1104 bytes', () => {
    const shortBuf = Buffer.alloc(500);
    expect(() => parseUserData(shortBuf)).toThrow('too short');
  });
});

describe('parseJobData', () => {
  it('decodes job data from a 96-byte buffer with 6 INT fields', () => {
    const buf = buildTestJobBuffer();
    const job = parseJobData(buf);

    expect(job.supervisor).toBe('Supervisor1');
    expect(job.orderNumber).toBe('ORD-001');
    expect(job.serialNumber).toBe('SN-001');
    expect(job.remoteJobEnable).toBe(0);
    expect(job.maintenanceRequest).toBe(0);
    expect(job.remoteCycleSelection).toBe(0);
    expect(job.cycleType).toBe(CycleType.DRY_MIXED);
    expect(job.spareInt02).toBe(0);
    expect(job.spareInt03).toBe(0);
  });

  it('throws on buffer shorter than 96 bytes (rejects V01/V02 job packets)', () => {
    const shortBuf = Buffer.alloc(92); // V01/V02 pre-N+1 job size, now rejected
    expect(() => parseJobData(shortBuf)).toThrow('too short');
  });
});

describe('buildUserWritePacket', () => {
  it('produces a 1104-byte buffer that round-trips with parseUserData', () => {
    const users = [
      { tagId: 1, name: 'Operator1', group: RfidUserGroup.OPERATOR, enabled: true },
      { tagId: 2, name: 'Maint1', group: RfidUserGroup.MAINTENANCE, enabled: false },
    ];

    // Pad to 48 users
    for (let i = users.length; i < 48; i++) {
      users.push({ tagId: i + 1, name: '', group: RfidUserGroup.OPERATOR, enabled: false });
    }

    const buf = buildUserWritePacket(users);
    expect(buf.length).toBe(1104);

    const parsed = parseUserData(buf);
    expect(parsed[0]!.name).toBe('Operator1');
    expect(parsed[0]!.group).toBe(RfidUserGroup.OPERATOR);
    expect(parsed[0]!.enabled).toBe(true);
    expect(parsed[1]!.name).toBe('Maint1');
    expect(parsed[1]!.group).toBe(RfidUserGroup.MAINTENANCE);
    expect(parsed[1]!.enabled).toBe(false);
  });
});

describe('buildJobWritePacket', () => {
  it('produces a 96-byte buffer that round-trips with parseJobData (PROT-V03-12)', () => {
    const job = {
      supervisor: 'alice',
      orderNumber: 'WO-42',
      serialNumber: 'SN-1',
      remoteJobEnable: 0,
      maintenanceRequest: 0,
      remoteCycleSelection: 0,
      cycleType: CycleType.ORGANIC,
      spareInt02: 99,
      spareInt03: 88,
    };

    const buf = buildJobWritePacket(job);
    expect(buf.length).toBe(96);

    // Round-trip: parse, rebuild, assert byte-identical
    const parsed = parseJobData(buf);
    expect(parsed.supervisor).toBe('alice');
    expect(parsed.orderNumber).toBe('WO-42');
    expect(parsed.serialNumber).toBe('SN-1');
    expect(parsed.cycleType).toBe(CycleType.ORGANIC);
    expect(parsed.spareInt02).toBe(99);
    expect(parsed.spareInt03).toBe(88);
    const rebuilt = buildJobWritePacket(parsed);
    expect(rebuilt.equals(buf)).toBe(true);
  });
});

describe('Round-trip tests (simulator format -> parser)', () => {
  it('parseMachineData round-trips with V03 fixture buffer', () => {
    const buf = buildTestMachineBuffer();
    const snapshot = parseMachineData(buf);

    // Verify key V03 values survive the round-trip
    expect(snapshot.thermoLeftLower).toBe(180);
    expect(snapshot.garbageTemp).toBe(450);
    expect(snapshot.completedCycles).toBe(42);
    expect(snapshot.user).toBe('Mario');
    expect(snapshot.energyConsumption).toBeCloseTo(123.45, 1);
    expect(snapshot.thermoLeftLowSel).toBe(1);
    // V03 NEW
    expect(snapshot.cycleStatus).toBe(2);
    expect(snapshot.container).toBe(13);
    expect(snapshot.waterConsumption).toBeCloseTo(55.7, 1); // NEW offset 304
    expect(snapshot.lineVoltL1L2).toBeCloseTo(400.5, 1);
  });

  it('parseAlarmWords round-trips with fixture buffer', () => {
    const buf = buildTestAlarmBuffer();
    const alarms = parseAlarmWords(buf);

    // word[0] = 5 -> bits 0 and 2 active
    expect(alarms.words[0]! & 0x01).toBe(1); // bit 0
    expect(alarms.words[0]! & 0x04).toBe(4); // bit 2
    expect(alarms.words[0]! & 0x02).toBe(0); // bit 1 not set
  });
});

describe('endianness is config-driven', () => {
  it('setPlcEndian("be") decodes the Big-Endian fixture correctly', () => {
    setPlcEndian('be');
    const snapshot = parseMachineData(buildTestMachineBuffer());
    expect(snapshot.thermoLeftLower).toBe(180);
    expect(snapshot.completedCycles).toBe(42);
    expect(snapshot.energyConsumption).toBeCloseTo(123.45, 1);
    expect(snapshot.lineVoltL1L2).toBeCloseTo(400.5, 1);
  });

  it('setPlcEndian("le") on the SAME Big-Endian bytes yields byteswapped garbage', () => {
    // Proves the flag actually drives INT/REAL decode: reading BE bytes as LE
    // byteswaps them, so a value of 180 (0x00B4) reads as 0xB400 = -19456.
    setPlcEndian('le');
    const snapshot = parseMachineData(buildTestMachineBuffer());
    expect(snapshot.thermoLeftLower).not.toBe(180);
    expect(snapshot.energyConsumption).not.toBeCloseTo(123.45, 1);
  });

  it('setPlcEndian("le") decodes a genuinely Little-Endian buffer correctly', () => {
    // Build a minimal LE machine buffer at the real V03 offsets and prove LE
    // decodes RIGHT (not merely "differently" from BE).
    const buf = Buffer.alloc(326);
    buf.writeInt16LE(180, 0);      // thermoLeftLower (INT, offset 0)
    buf.writeInt32LE(42, 144);     // completedCycles (DINT, offset 144)
    buf.writeFloatLE(123.45, 260); // energyConsumption (REAL, offset 260)

    setPlcEndian('le');
    const snapshot = parseMachineData(buf);
    expect(snapshot.thermoLeftLower).toBe(180);
    expect(snapshot.completedCycles).toBe(42);
    expect(snapshot.energyConsumption).toBeCloseTo(123.45, 1);
  });
});
