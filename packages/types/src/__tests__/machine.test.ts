import { describe, it, expect } from 'vitest';
import {
  MachineSnapshotSchema,
  CLIENT_VISIBLE_FIELDS,
  WPT_VISIBLE_FIELDS,
  type IMachineSnapshot,
} from '../machine.js';

/** Build a fully-populated IMachineSnapshot fixture (all 100 V03 fields). */
function buildFixture(): IMachineSnapshot {
  return {
    // INT fields S1_I_DATO_1..72
    thermoLeftLower: 0,
    thermoLeftMedium: 0,
    thermoLeftUpper: 0,
    thermoRightLower: 0,
    thermoRightMedium: 0,
    thermoRightUpper: 0,
    thermoLeftHighLower: 0,
    thermoLeftHighMedium: 0,
    thermoLeftHighUpper: 0,
    thermoRightHighLower: 0,
    garbageTemp: 0,
    holdingTempSetpoint: 0,
    chamberPressure: 0,
    mainMotorSpeed: 0,
    mainMotorTorque: 0,
    mainMotorCurrent: 0,
    vacuumPumpSpeed01: 0,
    vacuumPumpSpeed02: 0,
    spareInt19: 0,
    spareInt20: 0,
    spareInt21: 0,
    spareInt22: 0,
    spareInt23: 0,
    spareInt24: 0,
    spareInt25: 0,
    spareInt26: 0,
    spareInt27: 0,
    spareInt28: 0,
    spareInt29: 0,
    spareInt30: 0,
    spareInt31: 0,
    spareInt32: 0,
    spareInt33: 0,
    spareInt34: 0,
    spareInt35: 0,
    spareInt36: 0,
    spareInt37: 0,
    spareInt38: 0,
    spareInt39: 0,
    spareInt40: 0,
    spareInt41: 0,
    spareInt42: 0,
    spareInt43: 0,
    spareInt44: 0,
    spareInt45: 0,
    spareInt46: 0,
    spareInt47: 0,
    spareInt48: 0,
    spareInt49: 0,
    spareInt50: 0,
    spareInt51: 0,
    spareInt52: 0,
    spareInt53: 0,
    spareInt54: 0,
    spareInt55: 0,
    spareInt56: 0,
    materialInputWeight: 0,
    materialOutputWeight: 0,
    selectedCycle: 0,
    currentPhase: 0,
    machineStatus: 0,
    spareInt62: 0,
    spareInt63: 0,
    spareInt64: 0,
    spareInt65: 0,
    spareInt66: 0,
    spareInt67: 0,
    spareInt68: 0,
    spareInt69: 0,
    spareInt70: 0,
    cycleStatus: 1,
    container: 3,
    // DINT fields
    completedCycles: 0,
    spareDint01: 0,
    // STRING fields
    user: '',
    supervisor: '',
    orderNumber: '',
    serialNumber: '',
    spareString01: '',
    // REAL fields V03 (15)
    energyConsumption: 0,
    rmsCurrL1: 0,
    rmsCurrL2: 0,
    rmsCurrL3: 0,
    rmsCurrN: 0,
    spareReal01: 0,
    lineVoltL1L2: 0,
    lineVoltL2L3: 0,
    lineVoltL3L1: 0,
    lineNeutralVoltL1: 0,
    lineNeutralVoltL2: 0,
    lineNeutralVoltL3: 0,
    pfTotal: 0,
    waterConsumption: 0,
    spareReal02: 0,
    // BYTE fields
    thermoLeftLowSel: 0,
    thermoLeftMedSel: 0,
    thermoLeftHighSel: 0,
    thermoRightLowSel: 0,
    thermoRightMedSel: 0,
    thermoRightHighSel: 0,
  };
}

describe('MachineSnapshotSchema (V03)', () => {
  it('parses a fully-populated V03 fixture without errors', () => {
    const fixture = buildFixture();
    const parsed = MachineSnapshotSchema.parse(fixture);
    expect(parsed.cycleStatus).toBe(1);
    expect(parsed.container).toBe(3);
    expect(parsed.lineVoltL1L2).toBe(0);
    expect(parsed.spareReal02).toBe(0);
  });

  it('rejects payload where cycleStatus is a string', () => {
    const bad = { ...buildFixture(), cycleStatus: 'not-an-int' as unknown as number };
    expect(() => MachineSnapshotSchema.parse(bad)).toThrow();
  });
});

describe('CLIENT_VISIBLE_FIELDS (V03)', () => {
  it('has exactly 20 entries', () => {
    expect(CLIENT_VISIBLE_FIELDS.length).toBe(20);
  });

  it('includes cycleStatus and container', () => {
    expect(CLIENT_VISIBLE_FIELDS).toContain('cycleStatus');
    expect(CLIENT_VISIBLE_FIELDS).toContain('container');
  });
});

describe('WPT_VISIBLE_FIELDS (V03)', () => {
  it('has exactly 89 entries', () => {
    expect(WPT_VISIBLE_FIELDS.length).toBe(89);
  });

  it('includes the 7 new V03 electrical REAL fields', () => {
    expect(WPT_VISIBLE_FIELDS).toContain('lineVoltL1L2');
    expect(WPT_VISIBLE_FIELDS).toContain('lineVoltL2L3');
    expect(WPT_VISIBLE_FIELDS).toContain('lineVoltL3L1');
    expect(WPT_VISIBLE_FIELDS).toContain('lineNeutralVoltL1');
    expect(WPT_VISIBLE_FIELDS).toContain('lineNeutralVoltL2');
    expect(WPT_VISIBLE_FIELDS).toContain('lineNeutralVoltL3');
    expect(WPT_VISIBLE_FIELDS).toContain('pfTotal');
  });

  it('does NOT include spareReal02 (excluded by design)', () => {
    expect(WPT_VISIBLE_FIELDS).not.toContain('spareReal02' as never);
  });

  it('does NOT include the renamed spareInt71 / spareInt72 keys', () => {
    expect(WPT_VISIBLE_FIELDS).not.toContain('spareInt71' as never);
    expect(WPT_VISIBLE_FIELDS).not.toContain('spareInt72' as never);
  });
});
