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
    // D1: Core process signals
    vacuumPumpSpeed02: 780,
    rmsCurrN: 0.5,
    thermoLeftLower: 160,
    thermoLeftMedium: 170,
    thermoLeftUpper: 175,
    thermoRightLower: 158,
    thermoRightMedium: 168,
    thermoRightUpper: 173,
    holdingTempSetpoint: 180,
    waterConsumption: 12,
    ...overrides,
  };
}

describe('OnlineAnomalyDetector', () => {
  it('keeps scores low for steady normal observations after warmup', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 20,
      criticalThreshold: 3,
      baseRate: 0.12,
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
      minReliableSamples: 25,
      criticalThreshold: 3,
      baseRate: 0.1,
      modeChangeGraceMs: 0, // disable grace period for unit test timing
      persistenceN: 1, // disable N-of-M for single-spike test
      persistenceM: 1,
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
      criticalThreshold: 3,
      baseRate: 0.1,
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

  it('groups correlated RMS current features — only max enters top-K (FIX 8)', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 15,
      minReliableSamples: 25,
      criticalThreshold: 3,
      baseRate: 0.1,
      topK: 3,
      modeChangeGraceMs: 0,
    });

    // Warmup with steady values
    for (let i = 0; i < 25; i += 1) {
      detector.observe(
        makeSample({
          rmsCurrL1: 15 + (i % 2) * 0.1,
          rmsCurrL2: 15 + (i % 2) * 0.1,
          rmsCurrL3: 15 + (i % 2) * 0.1,
        }),
      );
    }

    // Spike all three RMS currents — without grouping, all 3 would
    // occupy the top-K and inflate the score ~3×.
    const spiked = detector.observe(
      makeSample({
        rmsCurrL1: 80,
        rmsCurrL2: 78,
        rmsCurrL3: 79,
      }),
    );

    // Only ONE RMS current feature should appear in topContributors
    const rmsContributors = spiked.topContributors.filter((c) =>
      ['rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3'].includes(c.feature),
    );
    expect(rmsContributors).toHaveLength(1);
    // The max (rmsCurrL1=80) should be the one selected
    expect(rmsContributors[0]?.feature).toBe('rmsCurrL1');
  });

  it('C3: CUSUM detects slow persistent drift that z-score misses', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 10,
      minReliableSamples: 15,
      criticalThreshold: 5, // high threshold so z-score alone won't flag
      warningThreshold: 4,
      baseRate: 0.02, // slow EMA — mean adapts slowly
      modeChangeGraceMs: 0,
      topK: 3, // limit to avoid dilution from 22 stable features
      cusumK: 0.3,
      cusumH: 3.0, // lower decision boundary for faster test
      persistenceN: 1,
      persistenceM: 1,
    });

    // Warmup with tight steady-state data
    for (let i = 0; i < 20; i += 1) {
      detector.observe(makeSample({ garbageTemp: 180 + (i % 3) * 0.1 }));
    }

    // Apply a persistent moderate shift — composite score should be ~1-2
    // (above cusumK=0.3 but below criticalThreshold=5).
    // CUSUM accumulates and triggers after ~4-6 steps.
    let driftSeen = false;
    for (let i = 0; i < 40; i += 1) {
      const result = detector.observe(makeSample({ garbageTemp: 181.5 }));
      if (result.driftDetected) {
        driftSeen = true;
        break;
      }
    }

    expect(driftSeen).toBe(true);
  });

  it('C4: N-of-M filter suppresses single-sample noise spikes', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 10,
      minReliableSamples: 15,
      criticalThreshold: 3,
      baseRate: 0.1,
      modeChangeGraceMs: 0,
      persistenceN: 3,
      persistenceM: 5,
    });

    // Warmup
    for (let i = 0; i < 20; i += 1) {
      detector.observe(makeSample({ garbageTemp: 180 + (i % 2) * 0.3 }));
    }

    // Single spike — should NOT flag due to 3-of-5 requirement
    const spike = detector.observe(makeSample({ garbageTemp: 250 }));
    expect(spike.flagged).toBe(false);

    // Return to normal
    detector.observe(makeSample({ garbageTemp: 180.2 }));

    // Another spike — still only 1-of-last-5 flaggable, should NOT flag
    const spike2 = detector.observe(makeSample({ garbageTemp: 250 }));
    expect(spike2.flagged).toBe(false);
  });

  it('adapts to gradual drift without flagging every later sample', () => {
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 10,
      criticalThreshold: 3.2,
      baseRate: 0.2,
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
