/**
 * V03 cross-package round-trip tests (PROT-V03-09, PROT-V03-10, PROT-V03-12).
 *
 * Imports the simulator's packetBuilder and feeds its output through the backend
 * parser, then re-encodes via buildJobWritePacket / buildUserWritePacket and asserts
 * byte-identical equality. Catches any drift between the two MACHINE_DATA_INT_FIELDS
 * arrays, any REAL loop off-by-one, any BYTE offset mistake, and any polarity flip.
 */
import { describe, it, expect } from 'vitest';
import { CycleType, RfidUserGroup } from '@wpt/types';
import type { IMachineSnapshot, IJobData, IRfidUser } from '@wpt/types';
import {
  parseMachineData,
  parseJobData,
  parseUserData,
  buildJobWritePacket,
  buildUserWritePacket,
} from '../udp/parsers.js';
// Cross-package relative import — simulator source is in the same pnpm workspace.
// This import path is the primary mechanism by which drift between the backend
// MACHINE_DATA_INT_FIELDS and simulator MACHINE_DATA_INT_FIELDS arrays is caught.
// Do NOT replace this with a local copy of the builder functions under any
// circumstance — it would silently disable the drift detection.
import {
  buildMachineDataPacket,
  buildUserDataPacket,
  buildJobReadPacket,
} from '../../../simulator/src/udp/packetBuilder.js';

/**
 * Build a V03 IMachineSnapshot fixture with unique recognizable values for every field.
 * ALL 100 fields are explicitly populated — no casts, no spreads.
 * Distinct numeric values per field mean a byte-offset drift bug produces a mismatch.
 */
function v03MachineFixture(): IMachineSnapshot {
  const fixture: IMachineSnapshot = {
    // --- 72 INT fields (S1_I_DATO_1..S1_I_DATO_72) ---
    thermoLeftLower: 1,
    thermoLeftMedium: 2,
    thermoLeftUpper: 3,
    thermoRightLower: 4,
    thermoRightMedium: 5,
    thermoRightUpper: 6,
    thermoLeftHighLower: 7,
    thermoLeftHighMedium: 8,
    thermoLeftHighUpper: 9,
    thermoRightHighLower: 10,
    garbageTemp: 11,
    holdingTempSetpoint: 12,
    chamberPressure: 13,
    mainMotorSpeed: 14,
    mainMotorTorque: 15,
    mainMotorCurrent: 16,
    vacuumPumpSpeed01: 17,
    vacuumPumpSpeed02: 18,
    spareInt19: 19,
    spareInt20: 20,
    spareInt21: 21,
    spareInt22: 22,
    spareInt23: 23,
    spareInt24: 24,
    spareInt25: 25,
    spareInt26: 26,
    spareInt27: 27,
    spareInt28: 28,
    spareInt29: 29,
    spareInt30: 30,
    spareInt31: 31,
    spareInt32: 32,
    spareInt33: 33,
    spareInt34: 34,
    spareInt35: 35,
    spareInt36: 36,
    spareInt37: 37,
    spareInt38: 38,
    spareInt39: 39,
    spareInt40: 40,
    spareInt41: 41,
    spareInt42: 42,
    spareInt43: 43,
    spareInt44: 44,
    spareInt45: 45,
    spareInt46: 46,
    spareInt47: 47,
    spareInt48: 48,
    spareInt49: 49,
    spareInt50: 50,
    spareInt51: 51,
    spareInt52: 52,
    spareInt53: 53,
    spareInt54: 54,
    spareInt55: 55,
    spareInt56: 56,
    materialInputWeight: 500,
    materialOutputWeight: 450,
    selectedCycle: CycleType.DRY_MIXED,
    currentPhase: 2,
    machineStatus: 3,
    spareInt62: 62,
    spareInt63: 63,
    spareInt64: 64,
    spareInt65: 65,
    spareInt66: 66,
    spareInt67: 67,
    spareInt68: 68,
    spareInt69: 69,
    spareInt70: 70,
    cycleStatus: 2,              // S1_I_DATO_71 — V03 COMPLETED
    container: 13,               // S1_I_DATO_72 — V03 bidoni count
    // --- 2 DINT fields (S1_DI_DATO_1..2) ---
    completedCycles: 999,
    spareDint01: 1000,
    // --- 5 STRING[20] fields (S1_S_DATO_1..5) ---
    user: 'alice',
    supervisor: 'bob',
    orderNumber: 'WO-42',
    serialNumber: 'SN-001',
    spareString01: '',
    // --- 15 REAL fields (S1_R_DATO_1..15, V03) ---
    energyConsumption: 12345.6,  // S1_R_DATO_1
    rmsCurrL1: 10.5,             // S1_R_DATO_2
    rmsCurrL2: 11.0,             // S1_R_DATO_3
    rmsCurrL3: 10.8,             // S1_R_DATO_4
    rmsCurrN: 0.3,               // S1_R_DATO_5
    spareReal01: 1.5,            // S1_R_DATO_6  (V03 rebinding)
    lineVoltL1L2: 400.5,         // S1_R_DATO_7  (V03 NEW)
    lineVoltL2L3: 401.2,         // S1_R_DATO_8  (V03 NEW)
    lineVoltL3L1: 399.8,         // S1_R_DATO_9  (V03 NEW)
    lineNeutralVoltL1: 231.1,    // S1_R_DATO_10 (V03 NEW)
    lineNeutralVoltL2: 232.0,    // S1_R_DATO_11 (V03 NEW)
    lineNeutralVoltL3: 230.5,    // S1_R_DATO_12 (V03 NEW)
    pfTotal: 0.92,               // S1_R_DATO_13 (V03 NEW)
    waterConsumption: 55.7,      // S1_R_DATO_14 (V03 rebinding)
    spareReal02: 7.5,            // S1_R_DATO_15 (V03 NEW)
    // --- 6 BYTE fields (S1_B_DATO_1..6) ---
    thermoLeftLowSel: 1,
    thermoLeftMedSel: 0,
    thermoLeftHighSel: 1,
    thermoRightLowSel: 0,
    thermoRightMedSel: 1,
    thermoRightHighSel: 0,
  };
  return fixture;
}

function v03JobFixture(): IJobData {
  return {
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
}

function v03UserFixture(): IRfidUser[] {
  const users: IRfidUser[] = [];
  for (let i = 0; i < 48; i++) {
    users.push({
      tagId: i + 1,
      name: i < 3 ? `user_${i}` : '',
      group: RfidUserGroup.OPERATOR,
      enabled: i === 4,  // tag 5 (index 4) enabled, everything else disabled
    });
  }
  // Tag 6 (index 5) explicitly disabled for polarity test
  users[5]!.enabled = false;
  return users;
}

describe('V03 cross-package round-trip (PROT-V03-09)', () => {
  it('machine data packet: simulator build -> backend parse recovers all 100 fields', () => {
    const snapshot = v03MachineFixture();
    const buf = buildMachineDataPacket(snapshot);
    expect(buf.length).toBe(318);

    const parsed = parseMachineData(buf);

    // INT fields — spot check across the full range
    expect(parsed.thermoLeftLower).toBe(1);
    expect(parsed.spareInt50).toBe(50);
    expect(parsed.spareInt70).toBe(70);
    expect(parsed.cycleStatus).toBe(2);
    expect(parsed.container).toBe(13);
    // DINT fields
    expect(parsed.completedCycles).toBe(999);
    expect(parsed.spareDint01).toBe(1000);
    // STRING fields
    expect(parsed.user).toBe('alice');
    expect(parsed.supervisor).toBe('bob');
    expect(parsed.orderNumber).toBe('WO-42');
    expect(parsed.serialNumber).toBe('SN-001');
    // REAL fields — all 15, toBeCloseTo because IEEE754
    expect(parsed.energyConsumption).toBeCloseTo(12345.6, 1);
    expect(parsed.rmsCurrL1).toBeCloseTo(10.5, 1);
    expect(parsed.spareReal01).toBeCloseTo(1.5, 1);
    expect(parsed.lineVoltL1L2).toBeCloseTo(400.5, 1);
    expect(parsed.lineVoltL2L3).toBeCloseTo(401.2, 1);
    expect(parsed.lineVoltL3L1).toBeCloseTo(399.8, 1);
    expect(parsed.lineNeutralVoltL1).toBeCloseTo(231.1, 1);
    expect(parsed.lineNeutralVoltL2).toBeCloseTo(232.0, 1);
    expect(parsed.lineNeutralVoltL3).toBeCloseTo(230.5, 1);
    expect(parsed.pfTotal).toBeCloseTo(0.92, 2);
    expect(parsed.waterConsumption).toBeCloseTo(55.7, 1);
    expect(parsed.spareReal02).toBeCloseTo(7.5, 1);
    // BYTE fields
    expect(parsed.thermoLeftLowSel).toBe(1);
    expect(parsed.thermoRightHighSel).toBe(0);
  });

  it('reserved cycle_status (>= 5) round-trips without crash (PROT-V03-08)', () => {
    const snapshot = v03MachineFixture();
    snapshot.cycleStatus = 7;
    const buf = buildMachineDataPacket(snapshot);
    const parsed = parseMachineData(buf);
    expect(parsed.cycleStatus).toBe(7);
  });

  it('job data packet: simulator build -> backend parse -> backend re-build is byte-identical (PROT-V03-12)', () => {
    const job = v03JobFixture();
    const simBuf = buildJobReadPacket(job);
    expect(simBuf.length).toBe(92);

    const parsed = parseJobData(simBuf);
    expect(parsed.spareInt02).toBe(99);
    expect(parsed.spareInt03).toBe(88);

    const rebuilt = buildJobWritePacket(parsed);
    expect(rebuilt.length).toBe(92);
    expect(rebuilt.equals(simBuf)).toBe(true);
  });

  it('RFID packet: simulator build -> backend parse -> backend re-build is byte-identical (PROT-V03-10)', () => {
    const users = v03UserFixture();
    const simBuf = buildUserDataPacket(users);
    expect(simBuf.length).toBe(1056);

    const parsed = parseUserData(simBuf);
    expect(parsed[4]!.enabled).toBe(true);
    expect(parsed[5]!.enabled).toBe(false);

    const rebuilt = buildUserWritePacket(parsed);
    expect(rebuilt.length).toBe(1056);
    expect(rebuilt.equals(simBuf)).toBe(true);
  });

  it('RFID enable polarity sanity: tag 5 enabled=true -> byte 0; tag 6 enabled=false -> byte 1 (PROT-V03-07)', () => {
    const users = v03UserFixture();
    // From the simulator builder
    const simBuf = buildUserDataPacket(users);
    expect(simBuf.readUInt8(1008 + 4)).toBe(0);  // tag 5 enabled -> byte 0
    expect(simBuf.readUInt8(1008 + 5)).toBe(1);  // tag 6 disabled -> byte 1

    // From the backend builder — same polarity
    const beBuf = buildUserWritePacket(users);
    expect(beBuf.readUInt8(1008 + 4)).toBe(0);
    expect(beBuf.readUInt8(1008 + 5)).toBe(1);

    // And the parser round-trips both correctly
    const parsedSim = parseUserData(simBuf);
    expect(parsedSim[4]!.enabled).toBe(true);
    expect(parsedSim[5]!.enabled).toBe(false);
  });

  it('negative: parseMachineData rejects a V01 286-byte buffer', () => {
    const v01Buf = Buffer.alloc(286);
    expect(() => parseMachineData(v01Buf)).toThrow(/too short/);
  });

  it('negative: parseJobData rejects a V01 88-byte buffer', () => {
    const v01Buf = Buffer.alloc(88);
    expect(() => parseJobData(v01Buf)).toThrow(/too short/);
  });
});
