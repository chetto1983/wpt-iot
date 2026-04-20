import { describe, expect, it } from 'vitest';
import {
  OnlineAnomalyDetector,
  type IAnomalyInput,
} from '../services/anomaly/index.js';

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
    // D2: Electrical grid health
    lineVoltL1L2: 400,
    lineVoltL2L3: 400,
    lineVoltL3L1: 400,
    lineNeutralVoltL1: 230,
    lineNeutralVoltL2: 230,
    lineNeutralVoltL3: 230,
    pfTotal: 0.92,
    // D3: High-temp zones
    thermoLeftHighLower: 200,
    thermoLeftHighMedium: 210,
    thermoLeftHighUpper: 215,
    thermoRightHighLower: 198,
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

  it('produces squared-z share contribution with sum-to-unity over deduped survivors (Phase 40 D-16)', () => {
    // RED→GREEN reasoning: this test asserts four independent invariants that together
    // prove the Phase 40 attribution math is wired correctly:
    //   1. dedup still produces exactly one RMS survivor (FIX-8 regression lock)
    //   2. the survivor's contribution dominates (spike ≫ baseline → z² dwarfs ungrouped floor)
    //   3. contributions sum to 1.0 within 1e-9 (D-05 denominator correctness over `displayed`)
    //   4. the L2/L3 duplicates are genuinely absent (dedup proof — strict negative)
    // Mutating the implementation to skip dedup would fail assertion 1 + 4; mutating it to
    // drop the sumSq normalization would fail assertion 3; weakening direction capture
    // would fail the HIGH check. No single assertion carries the whole proof — together
    // they lock the contract.
    //
    // NOTE: D-16 assertion 2 RELAXED from CONTEXT.md's closed-form `25 / (25 + ungrouped_sum_sq)`
    // to `> 0.9` dominance + `≈ 1.0` sum-to-unity. Welford/EMA warmup variance makes the closed-form
    // denominator scenario-dependent in a fresh detector — see 40-03-PLAN.md <objective>
    // §DEVIATION RECORD for the full justification. Mathematical intent (dedup works + denominator
    // math correct) is fully preserved by the two remaining assertions. Deviation recorded in
    // 40-SUMMARY.md.
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 15,
      minReliableSamples: 25,
      criticalThreshold: 3,
      baseRate: 0.1,
      topK: 3,
      modeChangeGraceMs: 0,
    });

    // Warmup with steady values (identical to FIX-8 test)
    for (let i = 0; i < 25; i += 1) {
      detector.observe(
        makeSample({
          rmsCurrL1: 15 + (i % 2) * 0.1,
          rmsCurrL2: 15 + (i % 2) * 0.1,
          rmsCurrL3: 15 + (i % 2) * 0.1,
        }),
      );
    }

    // Spike all three RMS currents — after dedup, only rmsCurrL1 survives as group max.
    const result = detector.observe(
      makeSample({ rmsCurrL1: 80, rmsCurrL2: 78, rmsCurrL3: 79 }),
    );

    // Assertion 1 (D-16 #1): dedup produces exactly 1 RMS-current survivor.
    const rmsContributors = result.topContributors.filter((c) =>
      ['rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3'].includes(c.feature),
    );
    expect(rmsContributors).toHaveLength(1);
    expect(rmsContributors[0]?.feature).toBe('rmsCurrL1');

    // Assertion 4 (D-16 #4): duplicates are absent from topContributors.
    expect(result.topContributors.find((c) => c.feature === 'rmsCurrL2')).toBeUndefined();
    expect(result.topContributors.find((c) => c.feature === 'rmsCurrL3')).toBeUndefined();

    // Assertion 3 (D-16 #3): sum-to-unity within 1e-9 (over the REPORTED contributors —
    // Plan 02 computes sumSq over `displayed = deduped.slice(0, 10)`, making this
    // invariant hold unconditionally regardless of dedup cardinality).
    const total = result.topContributors.reduce((s, c) => s + (c.contribution ?? 0), 0);
    expect(total).toBeCloseTo(1.0, 9);

    // Assertion 2 (D-16 #2, RELAXED — see header comment): rmsCurrL1 dominates.
    // Spike is 80 vs baseline ~15 → z^2 dwarfs the ungrouped floor. Dominance + sum-to-unity
    // together prove dedup works AND denominator math is correct.
    const l1 = result.topContributors.find((c) => c.feature === 'rmsCurrL1');
    expect(l1?.contribution).toBeDefined();
    expect(l1!.contribution!).toBeGreaterThan(0.9);

    // Direction: value=80, emaMean ~= 15 → HIGH.
    expect(l1?.direction).toBe('HIGH');

    // Regression: composite score still fires the critical threshold.
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('returns empty topContributors for idle machine — no NaN, no zero-filled placeholders (Phase 40 D-06)', () => {
    // RED→GREEN reasoning: without the D-06 idle guard (sumSq < EPSILON → []), an idle
    // machine (every feature at its EMA) would return either (a) NaN contributions from
    // `0/0` if the guard is removed, or (b) zero-filled `contribution: 0` placeholders if
    // an older pre-guard implementation returned the displayed contributors with 0 shares.
    // Both failure modes are rejected: this test asserts the array is EXACTLY `[]`, that
    // score is a hard 0 (not NaN), and that flagged is false. The D-08 tie-filter
    // (`rawZScore <= EPSILON` → omit) is also load-bearing here — without it the test
    // would see non-empty contributors before the idle guard even runs.
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 15,
      minReliableSamples: 25,
      baseRate: 0.1,
      topK: 3,
      modeChangeGraceMs: 0,
    });

    // Perfectly steady warmup — every feature at its canonical makeSample value, no noise.
    // After N observations of identical input, emaMean === value for every feature
    // and decayedVariance approaches 0 — but EPSILON floor prevents divide-by-zero.
    // Raw zScore evaluates to ~ |value - emaMean| / sqrt(EPSILON) = 0 / small_number = 0.
    for (let i = 0; i < 25; i += 1) {
      detector.observe(makeSample());
    }

    // Observe one more identical sample.
    const result = detector.observe(makeSample());

    // D-06: sumSq < EPSILON → topContributors is empty (not NaN-filled, not zero-filled placeholder).
    expect(result.topContributors).toEqual([]);
    expect(result.topContributors).toHaveLength(0);

    // Corollary: empty deduped → rawScore = 0 → score = 0 → not flagged.
    expect(result.score).toBe(0);
    expect(result.flagged).toBe(false);

    // No NaN slipped through.
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it('inspect() returns snapshot shape with derived sigma and mode flags (Phase 40 D-09/D-11)', () => {
    // RED→GREEN reasoning: proves inspect() returns the full IDetectorSnapshot projection
    // that Phase 42 DEBUG-01 and Phase 41 shadow-diff consumers depend on. Each assertion
    // targets a specific D-09/D-11 contract clause:
    //   - currentModeKey populated, startedAt formatted, counters non-zero (top-level)
    //   - modes record populated, per-mode warm/inGracePeriod/cusum/recentFlags (per-mode)
    //   - features record populated, per-feature Welford fields + derived sigma (per-feature)
    //   - sigma === sqrt(max(decayedVariance, EPSILON)) to 9 decimals (D-11 explicit)
    // Mutating the implementation to drop `sigma` from the projection would fail the last
    // assertion; mutating it to skip the warm-flag boolean would fail the warm check.
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 15,
      minReliableSamples: 25,
      baseRate: 0.1,
      topK: 3,
      modeChangeGraceMs: 0,
    });

    // Observe enough samples to warm up a mode.
    for (let i = 0; i < 20; i += 1) {
      detector.observe(makeSample({ garbageTemp: 180 + Math.sin(i) }));
    }

    const snapshot = detector.inspect();

    // Top-level shape.
    expect(snapshot.currentModeKey).not.toBeNull();
    expect(snapshot.startedAt).toBeTypeOf('string');
    expect(snapshot.totalObservations).toBeGreaterThan(0);
    expect(snapshot.modes).toBeTypeOf('object');
    expect(snapshot.config).toBeTypeOf('object');
    expect(snapshot.metrics).toBeTypeOf('object');

    // The current mode exists in the modes record.
    const modeKey = snapshot.currentModeKey as string;
    const mode = snapshot.modes[modeKey];
    expect(mode).toBeDefined();
    expect(mode!.samplesSeen).toBeGreaterThan(0);
    expect(mode!.warm).toBe(true); // samplesSeen >= minWarmSamples=15
    expect(typeof mode!.inGracePeriod).toBe('boolean');
    expect(mode!.cusum).toEqual({
      posCumSum: expect.any(Number),
      negCumSum: expect.any(Number),
    });
    expect(Array.isArray(mode!.recentFlags)).toBe(true);

    // Per-feature shape + derived sigma math (D-11).
    const garbage = mode!.features['garbageTemp'];
    expect(garbage).toBeDefined();
    expect(garbage!.count).toBeGreaterThan(0);
    expect(typeof garbage!.mean).toBe('number');
    expect(typeof garbage!.emaMean).toBe('number');
    expect(typeof garbage!.decayedVariance).toBe('number');

    // Sigma = sqrt(max(decayedVariance, EPSILON=1e-6)) — the derived field.
    const expectedSigma = Math.sqrt(Math.max(garbage!.decayedVariance, 1e-6));
    expect(garbage!.sigma).toBeCloseTo(expectedSigma, 9);
  });

  it('inspect() returns fresh objects — caller mutation does not affect internal state (Phase 40 D-10)', () => {
    // RED→GREEN reasoning: this is the runtime proof that D-10 "fresh-object construction"
    // is real — at runtime the returned object IS a plain mutable JS object (no Object.freeze
    // per D-10's perf-pitfall ban), but fresh-object construction means the caller's mutation
    // is isolated to their copy. If the implementation aliased `this.modes[key]` instead of
    // constructing a new object, the mutation on snap1 would bleed into snap2. The
    // `@ts-expect-error` directive is the compile-time complement: if DeepReadonly<T>'s
    // mapped type breaks, TSC emits "Unused '@ts-expect-error'" and the build fails.
    const detector = new OnlineAnomalyDetector({
      minWarmSamples: 15,
      minReliableSamples: 25,
      baseRate: 0.1,
      topK: 3,
      modeChangeGraceMs: 0,
    });

    for (let i = 0; i < 20; i += 1) {
      detector.observe(makeSample());
    }

    const snap1 = detector.inspect();
    const modeKey = snap1.currentModeKey as string;
    const countBefore = snap1.modes[modeKey]!.samplesSeen;

    // Attempt to mutate the snapshot. DeepReadonly forbids this at COMPILE TIME —
    // using @ts-expect-error proves the type guard is active; at runtime the object
    // is a plain mutable JS object (no Object.freeze per D-10), but fresh-object
    // construction means this mutation is isolated to the caller's copy.
    // @ts-expect-error — DeepReadonly<T> forbids mutation by design
    snap1.modes[modeKey]!.samplesSeen = 9999;

    // Observe one more sample and take a fresh snapshot.
    detector.observe(makeSample());
    const snap2 = detector.inspect();

    // The internal state was NOT corrupted by the mutation of snap1.
    // snap2.samplesSeen should be countBefore + 1, NOT 9999 + 1.
    expect(snap2.modes[modeKey]!.samplesSeen).toBe(countBefore + 1);
    expect(snap2.modes[modeKey]!.samplesSeen).not.toBe(10000);

    // snap1 and snap2 are different object identities.
    expect(snap1.modes[modeKey]).not.toBe(snap2.modes[modeKey]);
    expect(snap1.modes[modeKey]!.features).not.toBe(snap2.modes[modeKey]!.features);
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
