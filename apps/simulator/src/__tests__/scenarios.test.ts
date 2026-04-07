import { describe, it, expect, beforeEach } from 'vitest';
import { CycleType, MachineStatus, RfidUserGroup, RemoteJobEnable, MaintenanceRequest, RemoteCycleSelection } from '@wpt/types';
import type { IRfidUser } from '@wpt/types';
import { createDefaultMachineData, createDefaultUsers, createDefaultJob, ITALIAN_NAMES } from '../state/defaults.js';
import { SCENARIOS, applyScenario } from '../state/scenarios.js';
import { getState, resetState } from '../state/simulatorState.js';
import { loadPersistedState, savePersistedState } from '../persistence/jsonStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('defaults', () => {
  describe('createDefaultMachineData', () => {
    it('returns an object with all 100 IMachineSnapshot fields populated (V03)', () => {
      const data = createDefaultMachineData();
      // V03: 72 INT + 2 DINT + 5 STRING + 15 REAL + 6 BYTE = 100 fields
      const keys = Object.keys(data);
      expect(keys.length).toBe(100);

      // Spot check field existence
      expect(data.thermoLeftLower).toBeDefined();
      expect(data.garbageTemp).toBeDefined();
      expect(data.chamberPressure).toBeDefined();
      expect(data.mainMotorSpeed).toBeDefined();
      expect(data.completedCycles).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.energyConsumption).toBeDefined();
      expect(data.thermoLeftLowSel).toBeDefined();
      expect(data.cycleStatus).toBeDefined();   // V03 — replaces spareInt71
      expect(data.container).toBeDefined();     // V03 — replaces spareInt72
      expect(data.spareDint01).toBeDefined();
      expect(data.spareString01).toBeDefined();
      expect(data.spareReal01).toBeDefined();
      expect(data.lineVoltL1L2).toBeDefined();  // V03 NEW
      expect(data.pfTotal).toBeDefined();       // V03 NEW
      expect(data.spareReal02).toBeDefined();   // V03 NEW
      expect(data.thermoRightHighSel).toBeDefined();
    });
  });

  describe('createDefaultUsers', () => {
    let users: IRfidUser[];
    beforeEach(() => {
      users = createDefaultUsers();
    });

    it('returns exactly 48 IRfidUser objects', () => {
      expect(users.length).toBe(48);
    });

    it('uses Italian names', () => {
      expect(users[0]!.name).toBe('Mario Rossi');
      expect(users[47]!.name).toBe('Aldo Benedetti');
    });

    it('assigns correct groups: tags 1-10 Admin, 11-20 Maintenance, 21-48 Operator', () => {
      // Admin
      for (let i = 0; i < 10; i++) {
        expect(users[i]!.group).toBe(RfidUserGroup.ADMIN);
      }
      // Maintenance
      for (let i = 10; i < 20; i++) {
        expect(users[i]!.group).toBe(RfidUserGroup.MAINTENANCE);
      }
      // Operator
      for (let i = 20; i < 48; i++) {
        expect(users[i]!.group).toBe(RfidUserGroup.OPERATOR);
      }
    });

    it('has specific tags disabled (3, 15, 25, 30, 42)', () => {
      const disabledTags = [3, 15, 25, 30, 42];
      for (const tagId of disabledTags) {
        const user = users.find(u => u.tagId === tagId);
        expect(user?.enabled).toBe(false);
      }
    });

    it('has most tags enabled', () => {
      const enabledCount = users.filter(u => u.enabled).length;
      expect(enabledCount).toBe(43); // 48 - 5 disabled
    });
  });

  describe('createDefaultJob', () => {
    it('returns a valid IJobData with default values', () => {
      const job = createDefaultJob();
      expect(job.supervisor).toBe('');
      expect(job.orderNumber).toBe('');
      expect(job.serialNumber).toBe('');
      expect(job.remoteJobEnable).toBe(RemoteJobEnable.NO_REQUEST);
      expect(job.maintenanceRequest).toBe(MaintenanceRequest.NO_REQUEST);
      expect(job.remoteCycleSelection).toBe(RemoteCycleSelection.NO_REQUEST);
      expect(job.cycleType).toBe(CycleType.NO_CYCLE);
    });
  });

  describe('ITALIAN_NAMES', () => {
    it('has exactly 48 entries', () => {
      expect(ITALIAN_NAMES.length).toBe(48);
    });
  });
});

describe('scenarios', () => {
  beforeEach(() => {
    resetState();
  });

  describe('SCENARIOS.normal', () => {
    it('sets machineStatus=EVAPORATION (3) and selectedCycle=DRY_MIXED (3)', () => {
      const scenario = SCENARIOS['normal']!;
      expect(scenario.machine.machineStatus).toBe(MachineStatus.EVAPORATION);
      expect(scenario.machine.selectedCycle).toBe(CycleType.DRY_MIXED);
    });

    it('has all alarm words at 0', () => {
      const scenario = SCENARIOS['normal']!;
      expect(scenario.alarms.words.every(w => w === 0)).toBe(true);
    });
  });

  describe('SCENARIOS.alarmStorm', () => {
    it('sets machineStatus=LOADING (0) with IN_ALARM phase and has alarm bits set', () => {
      const scenario = SCENARIOS['alarmStorm']!;
      expect(scenario.machine.machineStatus).toBe(MachineStatus.LOADING);
      expect(scenario.alarms.words[0]).not.toBe(0);
    });

    it('has specific alarm word patterns', () => {
      const scenario = SCENARIOS['alarmStorm']!;
      expect(scenario.alarms.words[0]).toBe(0x0303);
      expect(scenario.alarms.words[1]).toBe(0x0209);
      expect(scenario.alarms.words[2]).toBe(0x2001);
    });
  });

  describe('SCENARIOS.maintenance', () => {
    it('sets machineStatus=LOADING (0) with MANUAL phase and selectedCycle=NO_CYCLE (0)', () => {
      const scenario = SCENARIOS['maintenance']!;
      expect(scenario.machine.machineStatus).toBe(MachineStatus.LOADING);
      expect(scenario.machine.selectedCycle).toBe(CycleType.NO_CYCLE);
    });
  });

  describe('SCENARIOS.idle', () => {
    it('sets machineStatus=LOADING (0) with STANDBY phase and sensor values near zero/ambient', () => {
      const scenario = SCENARIOS['idle']!;
      expect(scenario.machine.machineStatus).toBe(MachineStatus.LOADING);
      expect(scenario.machine.garbageTemp).toBe(22);
      expect(scenario.machine.chamberPressure).toBe(10);
      expect(scenario.machine.mainMotorSpeed).toBe(0);
      expect(scenario.machine.vacuumPumpSpeed01).toBe(0);
    });
  });

  describe('applyScenario', () => {
    it('updates simulatorState.machine and alarms coherently for normal', () => {
      applyScenario('normal');
      const state = getState();
      expect(state.machine.machineStatus).toBe(MachineStatus.EVAPORATION);
      expect(state.machine.selectedCycle).toBe(CycleType.DRY_MIXED);
      expect(state.machine.garbageTemp).toBe(180);
      expect(state.alarms.words.every(w => w === 0)).toBe(true);
    });

    it('updates alarms for alarmStorm scenario', () => {
      applyScenario('alarmStorm');
      const state = getState();
      expect(state.machine.machineStatus).toBe(MachineStatus.LOADING);
      expect(state.alarms.words[0]).toBe(0x0303);
    });
  });
});

describe('persistence', () => {
  const tmpDir = path.join(os.tmpdir(), 'wpt-simulator-test-' + Date.now());
  const tmpFile = path.join(tmpDir, 'test-state.json');

  it('loadPersistedState returns null when file does not exist', () => {
    const result = loadPersistedState('/nonexistent/path/state.json');
    expect(result).toBeNull();
  });

  it('savePersistedState + loadPersistedState round-trips state correctly', () => {
    const state = getState();
    savePersistedState(tmpFile, state);
    const loaded = loadPersistedState(tmpFile);
    expect(loaded).not.toBeNull();
    expect(loaded!.machine.thermoLeftLower).toBe(state.machine.thermoLeftLower);
    expect(loaded!.users.length).toBe(48);
    expect(loaded!.alarms.words.length).toBe(40);
    expect(loaded!.job.supervisor).toBe(state.job.supervisor);
    expect(loaded!.handshake.ackDelayMs).toBe(state.handshake.ackDelayMs);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
