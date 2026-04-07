import { describe, it, expect, beforeEach } from 'vitest';
import { CycleType, MachineStatus, RfidUserGroup, RemoteJobEnable } from '@wpt/types';
import type { IMachineSnapshot, IAlarmWords, IRfidUser } from '@wpt/types';
import { createDefaultMachineData, createDefaultUsers, createDefaultJob } from '../state/defaults.js';
import {
  buildMachineDataPacket,
  buildAlarmPacket,
  buildUserDataPacket,
  buildJobReadPacket,
  addNoise,
} from '../udp/packetBuilder.js';

describe('machine data packet', () => {
  let data: IMachineSnapshot;

  beforeEach(() => {
    data = createDefaultMachineData();
  });

  it('returns a Buffer of exactly 318 bytes (V03)', () => {
    const buf = buildMachineDataPacket(data);
    expect(buf.length).toBe(318);
  });

  it('writes thermoLeftLower (INT) at offset 0 as Big Endian', () => {
    data.thermoLeftLower = 150;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(0)).toBe(150);
  });

  it('writes garbageTemp (S1_I_DATO_11, INT) at offset 20 as Big Endian', () => {
    data.garbageTemp = 180;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(20)).toBe(180);
  });

  it('writes chamberPressure (S1_I_DATO_13, INT) at offset 24', () => {
    data.chamberPressure = 500;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(24)).toBe(500);
  });

  it('writes mainMotorSpeed (S1_I_DATO_14, INT) at offset 26', () => {
    data.mainMotorSpeed = 2000;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(26)).toBe(2000);
  });

  it('writes vacuumPumpSpeed01 (S1_I_DATO_17, INT) at offset 32', () => {
    data.vacuumPumpSpeed01 = 2200;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(32)).toBe(2200);
  });

  it('writes selectedCycle (S1_I_DATO_59, INT) at offset 116', () => {
    data.selectedCycle = CycleType.DRY_MIXED;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(116)).toBe(3);
  });

  it('writes machineStatus (S1_I_DATO_61, INT) at offset 120', () => {
    data.machineStatus = MachineStatus.EVAPORATION;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(120)).toBe(3);
  });

  it('writes completedCycles (DINT) at offset 144 as writeInt32BE', () => {
    data.completedCycles = 12345;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt32BE(144)).toBe(12345);
  });

  it('writes user (STRING[20]) starting at offset 152, null-padded to 20 bytes', () => {
    data.user = 'Mario Rossi';
    const buf = buildMachineDataPacket(data);
    const nameStr = buf.toString('ascii', 152, 172).replace(/\0+$/, '');
    expect(nameStr).toBe('Mario Rossi');
    // Check null padding
    expect(buf[163]).toBe(0); // 'i' is at 162 (offset 152 + 10), so 163 should still be 0 since 'Mario Rossi' is 11 chars
    // Actually 'Mario Rossi' is 11 chars, so offset 152+11 = 163 should be 0
    expect(buf.readUInt8(163)).toBe(0);
  });

  it('writes energyConsumption (REAL) at offset 252 as writeFloatBE', () => {
    data.energyConsumption = 450.5;
    const buf = buildMachineDataPacket(data);
    const value = buf.readFloatBE(252);
    expect(Math.abs(value - 450.5)).toBeLessThan(0.1);
  });

  it('writes cycleStatus (S1_I_DATO_71, INT) at offset 140 (V03)', () => {
    data.cycleStatus = 2;  // COMPLETED
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(140)).toBe(2);
  });

  it('writes container (S1_I_DATO_72, INT) at offset 142 (V03)', () => {
    data.container = 13;
    const buf = buildMachineDataPacket(data);
    expect(buf.readInt16BE(142)).toBe(13);
  });

  it('writes spareReal01 (S1_R_DATO_6, V03 rebinding) at offset 272', () => {
    data.spareReal01 = 42.0;
    const buf = buildMachineDataPacket(data);
    expect(buf.readFloatBE(272)).toBeCloseTo(42.0, 1);
  });

  it('writes lineVoltL1L2 (S1_R_DATO_7, V03 NEW) at offset 276', () => {
    data.lineVoltL1L2 = 400.5;
    const buf = buildMachineDataPacket(data);
    expect(buf.readFloatBE(276)).toBeCloseTo(400.5, 1);
  });

  it('writes pfTotal (S1_R_DATO_13, V03 NEW) at offset 300', () => {
    data.pfTotal = 0.92;
    const buf = buildMachineDataPacket(data);
    expect(buf.readFloatBE(300)).toBeCloseTo(0.92, 2);
  });

  it('writes waterConsumption (S1_R_DATO_14, V03) at offset 304 (NOT V01 offset 272)', () => {
    data.waterConsumption = 55.7;
    const buf = buildMachineDataPacket(data);
    expect(buf.readFloatBE(304)).toBeCloseTo(55.7, 1);
    // Confirm the V01 slot (272) is NOT the same value — it belongs to spareReal01 now.
    data.spareReal01 = 0.0;
    const buf2 = buildMachineDataPacket(data);
    expect(buf2.readFloatBE(272)).toBeCloseTo(0.0, 1);
  });

  it('writes spareReal02 (S1_R_DATO_15, V03 NEW) at offset 308', () => {
    data.spareReal02 = 7.5;
    const buf = buildMachineDataPacket(data);
    expect(buf.readFloatBE(308)).toBeCloseTo(7.5, 1);
  });

  it('writes thermoLeftLowSel (BYTE) at offset 312 as writeUInt8 (V03)', () => {
    data.thermoLeftLowSel = 1;
    const buf = buildMachineDataPacket(data);
    expect(buf.readUInt8(312)).toBe(1);
  });
});

describe('alarm packet', () => {
  it('returns a Buffer of exactly 80 bytes', () => {
    const alarms: IAlarmWords = { words: new Array(40).fill(0) };
    const buf = buildAlarmPacket(alarms);
    expect(buf.length).toBe(80);
  });

  it('writes word[0] at offset 0 as Big Endian INT', () => {
    const alarms: IAlarmWords = { words: new Array(40).fill(0) };
    alarms.words[0] = 0x0303;
    const buf = buildAlarmPacket(alarms);
    expect(buf.readInt16BE(0)).toBe(0x0303);
  });

  it('writes word[39] at offset 78 as Big Endian INT', () => {
    const alarms: IAlarmWords = { words: new Array(40).fill(0) };
    alarms.words[39] = 0x7FFF;
    const buf = buildAlarmPacket(alarms);
    expect(buf.readInt16BE(78)).toBe(0x7FFF);
  });
});

describe('user data packet', () => {
  let users: IRfidUser[];

  beforeEach(() => {
    users = createDefaultUsers();
  });

  it('returns a Buffer of exactly 1056 bytes', () => {
    const buf = buildUserDataPacket(users);
    expect(buf.length).toBe(1056);
  });

  it('writes first user name at offset 0, 20 bytes ASCII null-padded', () => {
    const buf = buildUserDataPacket(users);
    const name = buf.toString('ascii', 0, 20).replace(/\0+$/, '');
    expect(name).toBe('Mario Rossi');
  });

  it('writes first group byte at offset 960', () => {
    const buf = buildUserDataPacket(users);
    // First user is Admin = 2
    expect(buf.readUInt8(960)).toBe(RfidUserGroup.ADMIN);
  });

  it('writes first enabled byte at offset 1008', () => {
    const buf = buildUserDataPacket(users);
    // First user is enabled -> PLC byte 0
    expect(buf.readUInt8(1008)).toBe(0);
  });

  it('writes disabled user with PLC byte 1 (inverted logic)', () => {
    const buf = buildUserDataPacket(users);
    // Tag 3 (index 2) is disabled -> PLC byte 1
    expect(buf.readUInt8(1008 + 2)).toBe(1);
  });
});

describe('job read packet', () => {
  it('returns a Buffer of 92 bytes (V03)', () => {
    const job = createDefaultJob();
    const buf = buildJobReadPacket(job);
    expect(buf.length).toBe(92);
  });

  it('writes supervisor string at offset 0', () => {
    const job = createDefaultJob();
    job.supervisor = 'Test Supervisor';
    const buf = buildJobReadPacket(job);
    const name = buf.toString('ascii', 0, 20).replace(/\0+$/, '');
    expect(name).toBe('Test Supervisor');
  });

  it('writes orderNumber at offset 20', () => {
    const job = createDefaultJob();
    job.orderNumber = 'ORD-001';
    const buf = buildJobReadPacket(job);
    const val = buf.toString('ascii', 20, 40).replace(/\0+$/, '');
    expect(val).toBe('ORD-001');
  });

  it('writes remoteJobEnable as INT at offset 80', () => {
    const job = createDefaultJob();
    job.remoteJobEnable = RemoteJobEnable.NEW_CYCLE_JOB_ENTRY;
    const buf = buildJobReadPacket(job);
    expect(buf.readInt16BE(80)).toBe(1);
  });

  it('writes cycleType as INT at offset 86', () => {
    const job = createDefaultJob();
    job.cycleType = CycleType.HOSPITAL;
    const buf = buildJobReadPacket(job);
    expect(buf.readInt16BE(86)).toBe(7);
  });

  it('writes spareInt02 (R1_I_DATO_5, V03 NEW) as INT at offset 88', () => {
    const job = createDefaultJob();
    job.spareInt02 = 99;
    const buf = buildJobReadPacket(job);
    expect(buf.readInt16BE(88)).toBe(99);
  });

  it('writes spareInt03 (R1_I_DATO_6, V03 NEW) as INT at offset 90', () => {
    const job = createDefaultJob();
    job.spareInt03 = 88;
    const buf = buildJobReadPacket(job);
    expect(buf.readInt16BE(90)).toBe(88);
  });
});

describe('addNoise', () => {
  it('returns a value within the min/max range', () => {
    const range = { min: 0, max: 200 };
    for (let i = 0; i < 100; i++) {
      const result = addNoise(100, range);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(200);
    }
  });

  it('returns an integer for INT fields', () => {
    const range = { min: 0, max: 200 };
    for (let i = 0; i < 50; i++) {
      const result = addNoise(100, range);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});
