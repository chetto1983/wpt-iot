import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../events/hub.js', () => ({
  dataHub: {
    onMachineData: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../services/anomaly/machineAnomalyEventService.js', () => ({
  MachineAnomalyEventService: {
    recordEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

import { dataHub } from '../events/hub.js';
import { machineAnomalyService, MachineAnomalyEventService } from '../services/anomaly/index.js';

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

/**
 * Keep unit-test warmup short and remove the mode grace window so flagging
 * assertions are deterministic without burning seconds of wall-clock time.
 *
 *  - minReliableSamples=30 — confidence reaches 1.0 at the same sample count
 *    as warmup, so score is unscaled by confidence after warmup. Prod default
 *    is 200, intentionally cautious; tests don't need that conservatism.
 *  - modeChangeGraceMs=0 — mode entry grace normally suppresses WARNING-level
 *    flags for the first 30s after a mode change. Tests emit samples in
 *    microseconds, so grace would suppress every flag.
 *
 * criticalThreshold stays at production default (3.5) so the test still
 * exercises the real CRITICAL path.
 */
function configureForTest(): void {
  machineAnomalyService.updateDetectorConfig({
    minReliableSamples: 30,
    modeChangeGraceMs: 0,
  });
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

  it('reports that learning is continuous and restart-persistent', () => {
    machineAnomalyService.start(mockLog);

    // The service serialises detector state via serializeDetector()/
    // restoreDetector() on boot (Phase 4.1), so learning DOES survive
    // restarts when the persisted state is present. `continuousLearning`
    // remains true because each observe updates Welford stats in place.
    expect(machineAnomalyService.getTrackingStatus()).toMatchObject({
      active: true,
      continuousLearning: true,
      persistsAcrossRestart: true,
    });
  });

  it('flags a large anomaly once the live baseline is warm', () => {
    machineAnomalyService.start(mockLog);
    configureForTest();
    const handler = getMachineHandler();

    for (let i = 0; i < 30; i += 1) {
      handler(makeSnapshot(), new Date(Date.UTC(2026, 0, 1, 0, i, 0)));
    }

    // Emit 3 consecutive anomalous samples to satisfy C4 persistence (N=3 in M=5)
    for (let i = 0; i < 3; i += 1) {
      handler(
        makeSnapshot({
          garbageTemp: 240,
          chamberPressure: 3.2,
          mainMotorCurrent: 85,
        }),
        new Date(Date.UTC(2026, 0, 1, 1, i, 0)),
      );
    }

    const latest = machineAnomalyService.getLatest();
    expect(latest?.flagged).toBe(true);
    expect(latest?.score).toBeGreaterThanOrEqual(3);
    expect(MachineAnomalyEventService.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('suppresses repeated persisted events during the cooldown window', () => {
    machineAnomalyService.start(mockLog);
    configureForTest();
    const handler = getMachineHandler();

    for (let i = 0; i < 30; i += 1) {
      handler(makeSnapshot(), new Date(Date.UTC(2026, 0, 1, 0, i, 0)));
    }

    // Emit 3 consecutive anomalous samples — satisfies C4 persistence and
    // establishes the cooldown. Follow-ups within the cooldown window stay suppressed.
    for (let i = 0; i < 3; i += 1) {
      handler(
        makeSnapshot({
          garbageTemp: 240,
          chamberPressure: 3.2,
          mainMotorCurrent: 85,
        }),
        new Date(Date.UTC(2026, 0, 1, 1, i, 0)),
      );
    }
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
