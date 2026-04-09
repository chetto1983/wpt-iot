import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../events/hub.js', () => ({
  dataHub: {
    onMachineData: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../services/machineAnomalyEventService.js', () => ({
  MachineAnomalyEventService: {
    recordEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

import { dataHub } from '../events/hub.js';
import { machineAnomalyService } from '../services/machineAnomalyService.js';
import { MachineAnomalyEventService } from '../services/machineAnomalyEventService.js';

const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
};

function getMachineHandler(): (snapshot: Record<string, unknown>, timestamp: Date) => void {
  const calls = vi.mocked(dataHub.onMachineData).mock.calls;
  return calls[calls.length - 1]![0] as (snapshot: Record<string, unknown>, timestamp: Date) => void;
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    selectedCycle: 2,
    currentPhase: 3,
    machineStatus: 1,
    garbageTemp: 180,
    chamberPressure: -0.8,
    mainMotorSpeed: 1200,
    mainMotorCurrent: 45,
    mainMotorTorque: 12.5,
    vacuumPumpSpeed01: 800,
    energyConsumption: 50,
    rmsCurrL1: 15,
    rmsCurrL2: 15,
    rmsCurrL3: 15,
    materialInputWeight: 250,
    materialOutputWeight: 120,
    ...overrides,
  };
}

describe('machineAnomalyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    machineAnomalyService.resetForTest();
  });

  it('subscribes only once to live machine data', () => {
    machineAnomalyService.start(mockLog);
    machineAnomalyService.start(mockLog);

    expect(dataHub.onMachineData).toHaveBeenCalledTimes(1);
    expect(machineAnomalyService.getTrackingStatus().active).toBe(true);
  });

  it('continuously updates its live anomaly state from streamed snapshots', () => {
    machineAnomalyService.start(mockLog);
    const handler = getMachineHandler();

    for (let i = 0; i < 30; i += 1) {
      handler(
        makeSnapshot({
          garbageTemp: 180 + (i % 3) * 0.2,
          mainMotorCurrent: 45 + (i % 3) * 0.1,
        }),
        new Date(Date.UTC(2026, 0, 1, 0, i, 0)),
      );
    }

    const latest = machineAnomalyService.getLatest();
    expect(latest).not.toBeNull();
    expect(latest?.warm).toBe(true);
    expect(latest?.flagged).toBe(false);
    expect(machineAnomalyService.getTrackingStatus().observationCount).toBe(30);
  });

  it('reports that learning is continuous but not restart-persistent', () => {
    machineAnomalyService.start(mockLog);

    expect(machineAnomalyService.getTrackingStatus()).toMatchObject({
      active: true,
      continuousLearning: true,
      persistsAcrossRestart: false,
    });
  });

  it('flags a large anomaly once the live baseline is warm', () => {
    machineAnomalyService.start(mockLog);
    const handler = getMachineHandler();

    for (let i = 0; i < 25; i += 1) {
      handler(makeSnapshot(), new Date(Date.UTC(2026, 0, 1, 0, i, 0)));
    }

    handler(
      makeSnapshot({
        garbageTemp: 240,
        chamberPressure: 3.2,
        mainMotorCurrent: 85,
      }),
      new Date(Date.UTC(2026, 0, 1, 1, 0, 0)),
    );

    const latest = machineAnomalyService.getLatest();
    expect(latest?.flagged).toBe(true);
    expect(latest?.score).toBeGreaterThanOrEqual(3);
    expect(MachineAnomalyEventService.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('suppresses repeated persisted events during the cooldown window', () => {
    machineAnomalyService.start(mockLog);
    const handler = getMachineHandler();

    for (let i = 0; i < 25; i += 1) {
      handler(makeSnapshot(), new Date(Date.UTC(2026, 0, 1, 0, i, 0)));
    }

    handler(
      makeSnapshot({
        garbageTemp: 240,
        chamberPressure: 3.2,
        mainMotorCurrent: 85,
      }),
      new Date(Date.UTC(2026, 0, 1, 1, 0, 0)),
    );
    handler(
      makeSnapshot({
        garbageTemp: 241,
        chamberPressure: 3.1,
        mainMotorCurrent: 86,
      }),
      new Date(Date.UTC(2026, 0, 1, 1, 5, 0)),
    );

    expect(MachineAnomalyEventService.recordEvent).toHaveBeenCalledTimes(1);
  });
});
