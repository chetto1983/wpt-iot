import { describe, it, expect } from 'vitest';
import type { IMachineSnapshot } from '@wpt/types';
import { UserRole } from '@wpt/types';
import { filterByRole } from '../services/filterByRole.js';

/** Build a mock IMachineSnapshot with all 100 fields set to recognizable values */
function createMockSnapshot(): IMachineSnapshot {
  return {
    // INT fields (72)
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
    materialInputWeight: 57,
    materialOutputWeight: 58,
    selectedCycle: 59,
    currentPhase: 60,
    machineStatus: 61,
    spareInt62: 62,
    spareInt63: 63,
    spareInt64: 64,
    spareInt65: 65,
    spareInt66: 66,
    spareInt67: 67,
    spareInt68: 68,
    spareInt69: 69,
    spareInt70: 70,
    cycleStatus: 2,    // V03 — was spareInt71 in V01
    container: 13,     // V03 — was spareInt72 in V01
    // DINT fields (2)
    completedCycles: 1000,
    spareDint01: 2000,
    // STRING fields (5)
    user: 'testuser',
    supervisor: 'testsupervisor',
    orderNumber: 'ORD001',
    serialNumber: 'SER001',
    spareString01: 'spare',
    // REAL fields (15, V03)
    energyConsumption: 100.5,
    rmsCurrL1: 10.1,
    rmsCurrL2: 10.2,
    rmsCurrL3: 10.3,
    rmsCurrN: 0.5,
    spareReal01: 0.0,
    lineVoltL1L2: 400.5,
    lineVoltL2L3: 401.2,
    lineVoltL3L1: 399.8,
    lineNeutralVoltL1: 231.1,
    lineNeutralVoltL2: 232.0,
    lineNeutralVoltL3: 230.5,
    pfTotal: 0.92,
    waterConsumption: 50.0,
    spareReal02: 0.0,
    // BYTE fields (6)
    thermoLeftLowSel: 1,
    thermoLeftMedSel: 2,
    thermoLeftHighSel: 3,
    thermoRightLowSel: 4,
    thermoRightMedSel: 5,
    thermoRightHighSel: 6,
  };
}

describe('filterByRole', () => {
  const snapshot = createMockSnapshot();

  it('CLIENT role returns exactly 20 keys', () => {
    const result = filterByRole(snapshot, UserRole.CLIENT);
    expect(Object.keys(result).length).toBe(20);
  });

  it('CLIENT role includes garbageTemp and waterConsumption', () => {
    const result = filterByRole(snapshot, UserRole.CLIENT);
    expect(result.garbageTemp).toBe(11);
    expect(result.waterConsumption).toBe(50.0);
  });

  it('CLIENT role includes cycleStatus and container (V03 NEW)', () => {
    const result = filterByRole(snapshot, UserRole.CLIENT);
    expect(result.cycleStatus).toBe(2);
    expect(result.container).toBe(13);
  });

  it('CLIENT role does NOT include thermoLeftLower or rmsCurrL1', () => {
    const result = filterByRole(snapshot, UserRole.CLIENT);
    expect(result.thermoLeftLower).toBeUndefined();
    expect(result.rmsCurrL1).toBeUndefined();
  });

  it('WPT role returns exactly 89 keys', () => {
    const result = filterByRole(snapshot, UserRole.WPT);
    expect(Object.keys(result).length).toBe(89);
  });

  it('WPT role includes all CLIENT fields plus thermoLeftLower and rmsCurrL1', () => {
    const result = filterByRole(snapshot, UserRole.WPT);
    // CLIENT fields
    expect(result.garbageTemp).toBe(11);
    expect(result.waterConsumption).toBe(50.0);
    // WPT-only fields
    expect(result.thermoLeftLower).toBe(1);
    expect(result.rmsCurrL1).toBe(10.1);
  });

  it('WPT role includes 7 new V03 electrical REAL fields', () => {
    const result = filterByRole(snapshot, UserRole.WPT);
    expect(result.lineVoltL1L2).toBeCloseTo(400.5, 1);
    expect(result.lineVoltL2L3).toBeCloseTo(401.2, 1);
    expect(result.lineVoltL3L1).toBeCloseTo(399.8, 1);
    expect(result.lineNeutralVoltL1).toBeCloseTo(231.1, 1);
    expect(result.lineNeutralVoltL2).toBeCloseTo(232.0, 1);
    expect(result.lineNeutralVoltL3).toBeCloseTo(230.5, 1);
    expect(result.pfTotal).toBeCloseTo(0.92, 2);
  });

  it('WPT role does NOT include spareReal02 (explicit exclusion)', () => {
    const result = filterByRole(snapshot, UserRole.WPT);
    expect((result as Record<string, unknown>).spareReal02).toBeUndefined();
  });

  it('CLIENT role does NOT include the new WPT-only electrical REAL fields', () => {
    const result = filterByRole(snapshot, UserRole.CLIENT);
    expect((result as Record<string, unknown>).lineVoltL1L2).toBeUndefined();
    expect((result as Record<string, unknown>).pfTotal).toBeUndefined();
  });

  it('SUPER_ADMIN role returns exactly 89 keys (same as WPT)', () => {
    const result = filterByRole(snapshot, UserRole.SUPER_ADMIN);
    expect(Object.keys(result).length).toBe(89);
  });

  it('all CLIENT fields are a subset of WPT fields', () => {
    const clientResult = filterByRole(snapshot, UserRole.CLIENT);
    const wptResult = filterByRole(snapshot, UserRole.WPT);
    const clientKeys = Object.keys(clientResult);
    const wptKeys = new Set(Object.keys(wptResult));
    for (const key of clientKeys) {
      expect(wptKeys.has(key)).toBe(true);
    }
  });
});
