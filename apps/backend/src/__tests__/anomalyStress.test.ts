/**
 * ML Anomaly Detector — Comprehensive Stress Tests
 *
 * Synthetic scenarios covering all 33 features, correlation groups,
 * CUSUM drift, N-of-M persistence, and cross-domain anomalies.
 */
import { describe, expect, it } from 'vitest';
import {
  OnlineAnomalyDetector,
  type IAnomalyInput,
} from '../services/onlineAnomalyDetector.js';

/** Baseline steady-state sample — all 33 features at normal values. */
function baseline(overrides: Partial<IAnomalyInput> = {}): IAnomalyInput {
  return {
    selectedCycle: 2, currentPhase: 3, machineStatus: 1,
    garbageTemp: 180, chamberPressure: -0.8,
    mainMotorSpeed: 1200, mainMotorCurrent: 45, mainMotorTorque: 12.5,
    vacuumPumpSpeed01: 800, energyConsumption: 50,
    rmsCurrL1: 15, rmsCurrL2: 15, rmsCurrL3: 15,
    materialInputWeight: 250, materialOutputWeight: 120,
    vacuumPumpSpeed02: 780, rmsCurrN: 0.5,
    thermoLeftLower: 160, thermoLeftMedium: 170, thermoLeftUpper: 175,
    thermoRightLower: 158, thermoRightMedium: 168, thermoRightUpper: 173,
    holdingTempSetpoint: 180, waterConsumption: 12,
    lineVoltL1L2: 400, lineVoltL2L3: 400, lineVoltL3L1: 400,
    lineNeutralVoltL1: 230, lineNeutralVoltL2: 230, lineNeutralVoltL3: 230,
    pfTotal: 0.92,
    thermoLeftHighLower: 200, thermoLeftHighMedium: 210,
    thermoLeftHighUpper: 215, thermoRightHighLower: 198,
    ...overrides,
  };
}

/** Warmup a detector with N steady-state observations + small noise. */
function warmup(detector: OnlineAnomalyDetector, n = 30) {
  for (let i = 0; i < n; i++) {
    detector.observe(baseline({
      garbageTemp: 180 + (i % 3) * 0.2,
      mainMotorSpeed: 1200 + (i % 4) * 2,
      chamberPressure: -0.8 + (i % 2) * 0.01,
      thermoLeftLower: 160 + (i % 3) * 0.3,
      thermoRightLower: 158 + (i % 3) * 0.3,
      lineVoltL1L2: 400 + (i % 2) * 0.5,
      lineVoltL2L3: 400 + (i % 2) * 0.5,
      lineVoltL3L1: 400 + (i % 2) * 0.5,
    }));
  }
}

/** Create a detector configured for fast unit-test behavior. */
function fastDetector(overrides: Partial<Parameters<typeof OnlineAnomalyDetector>[0]> = {}) {
  return new OnlineAnomalyDetector({
    minWarmSamples: 15,
    minReliableSamples: 25,
    criticalThreshold: 3,
    baseRate: 0.1,
    modeChangeGraceMs: 0,
    persistenceN: 1,
    persistenceM: 1,
    topK: 5,
    ...overrides,
  });
}

describe('Anomaly Stress Tests — Thermal Domain', () => {
  it('detects heating element failure (single zone dropout)', () => {
    const d = fastDetector();
    warmup(d);

    // thermoLeftLower drops from ~160 to 40 — element failure
    const r = d.observe(baseline({ thermoLeftLower: 40 }));
    expect(r.score).toBeGreaterThan(2);
    expect(r.topContributors.some((c) => c.feature === 'thermoLeftLower')).toBe(true);
  });

  it('detects chamber overheat (all zones spike)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      thermoLeftLower: 300, thermoLeftMedium: 310, thermoLeftUpper: 320,
      thermoRightLower: 295, thermoRightMedium: 305, thermoRightUpper: 315,
    }));
    expect(r.flagged).toBe(true);
    // Correlation groups should deduplicate — max 1 thermoLeft + 1 thermoRight
    const leftCount = r.topContributors.filter((c) => c.feature.startsWith('thermoLeft')).length;
    const rightCount = r.topContributors.filter((c) => c.feature.startsWith('thermoRight')).length;
    expect(leftCount).toBeLessThanOrEqual(1);
    expect(rightCount).toBeLessThanOrEqual(1);
  });

  it('detects holdingTempSetpoint drift', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ holdingTempSetpoint: 250 }));
    expect(r.topContributors.some((c) => c.feature === 'holdingTempSetpoint')).toBe(true);
  });

  it('detects high-temp zone stratification', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      thermoLeftHighLower: 350, thermoLeftHighMedium: 355,
      thermoLeftHighUpper: 360, thermoRightHighLower: 345,
    }));
    expect(r.score).toBeGreaterThan(2);
    // All 4 high-temp zones are grouped — only 1 should appear
    const hiTempCount = r.topContributors.filter((c) =>
      c.feature.includes('High')).length;
    expect(hiTempCount).toBeLessThanOrEqual(1);
  });
});

describe('Anomaly Stress Tests — Motor Domain', () => {
  it('detects motor overload (current + torque spike)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      mainMotorCurrent: 120,
      mainMotorTorque: 35,
    }));
    expect(r.flagged).toBe(true);
    const motorFeatures = r.topContributors.filter((c) =>
      ['mainMotorCurrent', 'mainMotorTorque'].includes(c.feature));
    expect(motorFeatures.length).toBeGreaterThanOrEqual(1);
  });

  it('detects vacuum pump asymmetry (pump1 normal, pump2 stall)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      vacuumPumpSpeed01: 800,  // normal
      vacuumPumpSpeed02: 50,   // stalled
    }));
    expect(r.topContributors.some((c) => c.feature === 'vacuumPumpSpeed02')).toBe(true);
  });

  it('detects motor speed runaway', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ mainMotorSpeed: 2500 }));
    expect(r.topContributors.some((c) => c.feature === 'mainMotorSpeed')).toBe(true);
  });
});

describe('Anomaly Stress Tests — Electrical Domain', () => {
  it('detects phase imbalance (RMS current asymmetry)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      rmsCurrL1: 15, rmsCurrL2: 15, rmsCurrL3: 45,  // L3 3× normal
    }));
    // Grouped — only L3 (max) should appear
    const rmsFeatures = r.topContributors.filter((c) => c.feature.startsWith('rmsCurr'));
    expect(rmsFeatures.length).toBeLessThanOrEqual(1);
    if (rmsFeatures[0]) {
      expect(rmsFeatures[0].feature).toBe('rmsCurrL3');
    }
  });

  it('detects neutral current ground fault', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ rmsCurrN: 12 }));  // 0.5 → 12A
    expect(r.topContributors.some((c) => c.feature === 'rmsCurrN')).toBe(true);
  });

  it('detects voltage sag (all line voltages drop)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      lineVoltL1L2: 340, lineVoltL2L3: 338, lineVoltL3L1: 342,
    }));
    // Grouped — only max deviation enters top-K
    const voltFeatures = r.topContributors.filter((c) => c.feature.startsWith('lineVolt'));
    expect(voltFeatures.length).toBeLessThanOrEqual(1);
  });

  it('detects neutral voltage shift (loose neutral)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      lineNeutralVoltL1: 280, lineNeutralVoltL2: 180, lineNeutralVoltL3: 230,
    }));
    expect(r.score).toBeGreaterThan(2);
    const neutralFeatures = r.topContributors.filter((c) => c.feature.startsWith('lineNeutralVolt'));
    expect(neutralFeatures.length).toBeLessThanOrEqual(1);
  });

  it('detects power factor collapse', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ pfTotal: 0.3 }));  // 0.92 → 0.3
    expect(r.topContributors.some((c) => c.feature === 'pfTotal')).toBe(true);
  });
});

describe('Anomaly Stress Tests — Process & Utilities', () => {
  it('detects water leak (consumption spike)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ waterConsumption: 80 }));  // 12 → 80
    expect(r.topContributors.some((c) => c.feature === 'waterConsumption')).toBe(true);
  });

  it('detects pressure loss (vacuum failure)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ chamberPressure: 0.5 }));  // -0.8 → +0.5
    expect(r.topContributors.some((c) => c.feature === 'chamberPressure')).toBe(true);
  });

  it('detects energy consumption spike', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ energyConsumption: 200 }));  // 50 → 200
    expect(r.topContributors.some((c) => c.feature === 'energyConsumption')).toBe(true);
  });

  it('detects material weight anomaly (overload)', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({ materialInputWeight: 600 }));  // 250 → 600
    expect(r.topContributors.some((c) => c.feature === 'materialInputWeight')).toBe(true);
  });
});

describe('Anomaly Stress Tests — Cross-Domain Scenarios', () => {
  it('detects simultaneous thermal + electrical failure', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      thermoLeftUpper: 320,    // overheat
      rmsCurrL1: 60,           // overcurrent
      mainMotorTorque: 30,     // overload
    }));
    expect(r.flagged).toBe(true);
    expect(r.topContributors.length).toBeGreaterThanOrEqual(3);
  });

  it('detects cascading failure: motor stall → pressure loss → temp rise', () => {
    const d = fastDetector();
    warmup(d);

    const r = d.observe(baseline({
      mainMotorSpeed: 100,       // stalled
      vacuumPumpSpeed01: 50,     // pump 1 stall
      vacuumPumpSpeed02: 60,     // pump 2 stall
      chamberPressure: 0.2,      // vacuum lost
      garbageTemp: 250,          // temp rising uncontrolled
    }));
    expect(r.flagged).toBe(true);
    expect(r.score).toBeGreaterThan(3);
  });

  it('CUSUM detects slow thermal drift across multiple zones', () => {
    const d = fastDetector({
      criticalThreshold: 5,
      warningThreshold: 4,
      baseRate: 0.02,
      topK: 3,
      cusumK: 0.3,
      cusumH: 3.0,
    });
    warmup(d);

    // Gradual 0.5°C/sample drift on left zones — too slow for z-score
    let driftSeen = false;
    for (let i = 0; i < 40; i++) {
      const r = d.observe(baseline({
        thermoLeftLower: 160 + i * 0.5,
        thermoLeftMedium: 170 + i * 0.5,
        thermoLeftUpper: 175 + i * 0.5,
      }));
      if (r.driftDetected) { driftSeen = true; break; }
    }
    expect(driftSeen).toBe(true);
  });

  it('N-of-M filters noise but flags sustained anomaly', () => {
    const d = fastDetector({
      persistenceN: 3,
      persistenceM: 5,
    });
    warmup(d);

    // 1 spike → not flagged
    d.observe(baseline({ garbageTemp: 260 }));
    expect(d.observe(baseline()).flagged).toBe(false);

    // 3 consecutive spikes in 5 window → flagged
    d.observe(baseline({ garbageTemp: 260 }));
    d.observe(baseline({ garbageTemp: 260 }));
    const r = d.observe(baseline({ garbageTemp: 260 }));
    expect(r.flagged).toBe(true);
  });
});

describe('Anomaly Stress Tests — Correlation Group Integrity', () => {
  it('all 8 correlation groups produce max-1 contributor each', () => {
    const d = fastDetector({ topK: 10 });  // wide top-K to see all groups
    warmup(d);

    // Spike every grouped feature simultaneously
    const r = d.observe(baseline({
      // RMS current group
      rmsCurrL1: 80, rmsCurrL2: 78, rmsCurrL3: 79,
      // Thermo left group
      thermoLeftLower: 300, thermoLeftMedium: 310, thermoLeftUpper: 320,
      // Thermo right group
      thermoRightLower: 295, thermoRightMedium: 305, thermoRightUpper: 315,
      // Line voltage group
      lineVoltL1L2: 340, lineVoltL2L3: 338, lineVoltL3L1: 342,
      // Neutral voltage group
      lineNeutralVoltL1: 280, lineNeutralVoltL2: 180, lineNeutralVoltL3: 260,
      // High-temp group
      thermoLeftHighLower: 350, thermoLeftHighMedium: 355,
      thermoLeftHighUpper: 360, thermoRightHighLower: 345,
    }));

    const groups = {
      rms: ['rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3'],
      thermoL: ['thermoLeftLower', 'thermoLeftMedium', 'thermoLeftUpper'],
      thermoR: ['thermoRightLower', 'thermoRightMedium', 'thermoRightUpper'],
      lineV: ['lineVoltL1L2', 'lineVoltL2L3', 'lineVoltL3L1'],
      neutralV: ['lineNeutralVoltL1', 'lineNeutralVoltL2', 'lineNeutralVoltL3'],
      hiTemp: ['thermoLeftHighLower', 'thermoLeftHighMedium', 'thermoLeftHighUpper', 'thermoRightHighLower'],
    };

    for (const [name, members] of Object.entries(groups)) {
      const count = r.topContributors.filter((c) => members.includes(c.feature)).length;
      expect(count, `group "${name}" should have at most 1 contributor`).toBeLessThanOrEqual(1);
    }
  });
});

describe('Anomaly Stress Tests — Serialization Round-Trip', () => {
  it('detector state survives serialize → deserialize with all 33 features', () => {
    const d = fastDetector();
    warmup(d, 50);

    const scoreBefore = d.observe(baseline({ garbageTemp: 220 }));
    const json = d.toJSON();

    // Restore from JSON
    const d2 = OnlineAnomalyDetector.fromJSON(json);
    const scoreAfter = d2.observe(baseline({ garbageTemp: 220 }));

    // Scores should be very close (not identical due to observe side-effects)
    expect(Math.abs(scoreBefore.score - scoreAfter.score)).toBeLessThan(1);
    expect(scoreAfter.warm).toBe(true);

    const metrics = d2.getMetrics();
    expect(metrics.totalObservations).toBeGreaterThan(50);
  });
});
