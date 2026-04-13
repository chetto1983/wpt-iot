import { describe, it, expect } from 'vitest';
import type { IMachineSnapshot } from '@wpt/types';
import {
  CycleType,
  MaintenanceRequest,
  RemoteCycleSelection,
  RemoteJobEnable,
} from '@wpt/types';
import { mapMachineSnapshotToJobData } from '../routes/jobs.js';

function makeSnapshot(overrides: Partial<IMachineSnapshot> = {}): IMachineSnapshot {
  return {
    cycleStatus: 0,
    completedCycles: 0,
    currentPhase: 0,
    machineStatus: 0,
    selectedCycle: 0,
    materialInputWeight: 0,
    materialOutputWeight: 0,
    container: 0,
    energyConsumption: 0,
    waterConsumption: 0,
    user: '',
    supervisor: 'SUP-PLC',
    orderNumber: 'ORD-PLC',
    serialNumber: 'SN-PLC',
    thermoLeftLower: 0, thermoLeftMedium: 0, thermoLeftUpper: 0,
    thermoRightLower: 0, thermoRightMedium: 0, thermoRightUpper: 0,
    thermoLeftHighLower: 0, thermoLeftHighMedium: 0, thermoLeftHighUpper: 0,
    thermoRightHighLower: 0, garbageTemp: 0, holdingTempSetpoint: 0,
    chamberPressure: 0, mainMotorSpeed: 0, mainMotorTorque: 0,
    mainMotorCurrent: 0, vacuumPumpSpeed01: 0, vacuumPumpSpeed02: 0,
    spareInt19: 0, spareInt20: 0, spareInt21: 0, spareInt22: 0,
    spareInt23: 0, spareInt24: 0, spareInt25: 0, spareInt26: 0,
    spareInt27: 0, spareInt28: 0, spareInt29: 0, spareInt30: 0,
    spareInt31: 0, spareInt32: 0, spareInt33: 0, spareInt34: 0,
    spareInt35: 0, spareInt36: 0, spareInt37: 0, spareInt38: 0,
    spareInt39: 0, spareInt40: 0, spareInt41: 0, spareInt42: 0,
    spareInt43: 0, spareInt44: 0, spareInt45: 0, spareInt46: 0,
    spareInt47: 0, spareInt48: 0, spareInt49: 0, spareInt50: 0,
    spareInt51: 0, spareInt52: 0, spareInt53: 0, spareInt54: 0,
    spareInt55: 0, spareInt56: 0, spareInt62: 0, spareInt63: 0,
    spareInt64: 0, spareInt65: 12, spareInt66: 34, spareInt67: RemoteJobEnable.NEW_CYCLE_JOB_ENTRY,
    spareInt68: MaintenanceRequest.MAINTENANCE_REQUEST,
    spareInt69: RemoteCycleSelection.WAITING_FOR_REMOTE_CYCLE,
    spareInt70: CycleType.ORGANIC,
    spareDint01: 0,
    spareString01: '',
    rmsCurrL1: 0, rmsCurrL2: 0, rmsCurrL3: 0, rmsCurrN: 0,
    spareReal01: 0,
    lineVoltL1L2: 0, lineVoltL2L3: 0, lineVoltL3L1: 0,
    lineNeutralVoltL1: 0, lineNeutralVoltL2: 0, lineNeutralVoltL3: 0,
    pfTotal: 0,
    spareReal02: 0,
    thermoLeftLowSel: 0, thermoLeftMedSel: 0, thermoLeftHighSel: 0,
    thermoRightLowSel: 0, thermoRightMedSel: 0, thermoRightHighSel: 0,
    ...overrides,
  } as unknown as IMachineSnapshot;
}

describe('mapMachineSnapshotToJobData', () => {
  it('maps PLC broadcast strings and ints into the job read model', () => {
    const job = mapMachineSnapshotToJobData(makeSnapshot());

    expect(job).toEqual({
      supervisor: 'SUP-PLC',
      orderNumber: 'ORD-PLC',
      serialNumber: 'SN-PLC',
      remoteJobEnable: RemoteJobEnable.NEW_CYCLE_JOB_ENTRY,
      maintenanceRequest: MaintenanceRequest.MAINTENANCE_REQUEST,
      remoteCycleSelection: RemoteCycleSelection.WAITING_FOR_REMOTE_CYCLE,
      cycleType: CycleType.ORGANIC,
      spareInt02: 12,
      spareInt03: 34,
    });
  });
});
