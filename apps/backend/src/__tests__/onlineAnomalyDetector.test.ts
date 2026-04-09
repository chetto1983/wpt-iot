import { describe, expect, it } from 'vitest';
import {
  OnlineAnomalyDetector,
  type IAnomalyInput,
} from '../services/onlineAnomalyDetector.js';

function makeSample(overrides: Partial<IAnomalyInput> = {}): IAnomalyInput {
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

describe('OnlineAnomalyDetector', () => {
  it('keeps scores low for steady normal observations after warmup', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 20,
      scoreThreshold: 3,
      updateRate: 0.12,
    });

    for (let i = 0; i < 30; i += 1) {
      detector.observe(
        makeSample({
          garbageTemp: 180 + (i % 3) * 0.4,
          mainMotorSpeed: 1200 + (i % 4) * 5,
          mainMotorCurrent: 45 + (i % 5) * 0.2,
        }),
      );
    }

    const result = detector.observe(
      makeSample({
        garbageTemp: 180.6,
        mainMotorSpeed: 1208,
        mainMotorCurrent: 45.4,
      }),
    );

    expect(result.warm).toBe(true);
    expect(result.flagged).toBe(false);
    expect(result.score).toBeLessThan(3);
  });

  it('flags a clear multivariate anomaly spike', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 15,
      scoreThreshold: 3,
      updateRate: 0.1,
    });

    for (let i = 0; i < 25; i += 1) {
      detector.observe(
        makeSample({
          garbageTemp: 180 + (i % 2) * 0.5,
          chamberPressure: -0.8 + (i % 2) * 0.02,
          mainMotorCurrent: 45 + (i % 3) * 0.2,
        }),
      );
    }

    const anomaly = detector.observe(
      makeSample({
        garbageTemp: 230,
        chamberPressure: 2.5,
        mainMotorCurrent: 79,
        mainMotorTorque: 28,
      }),
    );

    expect(anomaly.warm).toBe(true);
    expect(anomaly.flagged).toBe(true);
    expect(anomaly.score).toBeGreaterThanOrEqual(3);
    expect(anomaly.topContributors.map((item) => item.feature)).toContain('garbageTemp');
  });

  it('keeps separate baselines per operating mode', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 10,
      scoreThreshold: 3,
      updateRate: 0.1,
    });

    for (let i = 0; i < 15; i += 1) {
      detector.observe(
        makeSample({
          selectedCycle: 1,
          currentPhase: 2,
          machineStatus: 0,
          garbageTemp: 90 + (i % 3),
          mainMotorSpeed: 600 + (i % 2) * 10,
        }),
      );
      detector.observe(
        makeSample({
          selectedCycle: 2,
          currentPhase: 3,
          machineStatus: 1,
          garbageTemp: 180 + (i % 3),
          mainMotorSpeed: 1200 + (i % 2) * 10,
        }),
      );
    }

    const lowTempMode = detector.observe(
      makeSample({
        selectedCycle: 1,
        currentPhase: 2,
        machineStatus: 0,
        garbageTemp: 92,
        mainMotorSpeed: 608,
      }),
    );
    const highTempMode = detector.observe(
      makeSample({
        selectedCycle: 2,
        currentPhase: 3,
        machineStatus: 1,
        garbageTemp: 182,
        mainMotorSpeed: 1208,
      }),
    );

    expect(lowTempMode.flagged).toBe(false);
    expect(highTempMode.flagged).toBe(false);
    expect(lowTempMode.modeKey).not.toBe(highTempMode.modeKey);
  });

  it('adapts to gradual drift without flagging every later sample', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 10,
      scoreThreshold: 3.2,
      updateRate: 0.2,
    });

    for (let i = 0; i < 20; i += 1) {
      detector.observe(makeSample({ garbageTemp: 180 + i * 0.1 }));
    }

    let last = detector.observe(makeSample({ garbageTemp: 184 }));
    expect(last.flagged).toBe(false);

    for (let i = 0; i < 12; i += 1) {
      last = detector.observe(makeSample({ garbageTemp: 184 + i * 0.1 }));
    }

    expect(last.flagged).toBe(false);
    expect(last.score).toBeLessThan(3.2);
  });
});
