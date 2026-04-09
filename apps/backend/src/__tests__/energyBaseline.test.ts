/**
 * Phase 20 — energyBaselineService unit tests
 *
 * Wave 0 (Plan 00) reserved every test name as `it.todo(...)`. Plan 01 turned the
 * `ensureSchema idempotent` stub green. Plan 02 turns the 6 pure-math stubs in
 * `computeSavings pure math` green and adds 2 belt-and-suspenders tests for
 * `_validateSavingsWindows`. The 3 stubs in `lockBaseline soft warnings` belong
 * to Plan 03.
 *
 * Test names in `computeSavings pure math` are VERBATIM from
 * 20-CONTEXT.md §specifics and 20-VALIDATION.md `-t` filter strings — do NOT
 * rename without re-syncing both files.
 *
 * Pure in-memory fixtures. No DB. No beforeEach. No pool.end().
 */

import { describe, it, expect } from 'vitest';
import {
  EnergyBaselineService,
  _computeSavingsFromScalars,
  _validateSavingsWindows,
  BaselineOverlapError,
  MeasurementTooShortError,
  type IScalarsInput,
} from '../services/energyBaselineService.js';

/** Builds an IScalarsInput with sensible defaults; overrides shallow-merge per nested object. */
function makeScalarsInput(overrides: Partial<IScalarsInput> = {}): IScalarsInput {
  const base: IScalarsInput = {
    baseline: {
      baselineId: 1,
      label: 'test baseline',
      enpi: 0.5, // 100 kWh / 200 kg
      totalKwh: 100,
      totalKg: 200,
      normalizationVariables: { temp: 20 },
      periodFrom: new Date('2026-01-01T00:00:00Z'),
      periodTo: new Date('2026-01-31T00:00:00Z'),
    },
    measurement: { totalKwh: 100, totalKg: 200 },
    baselineEurPerKwh: 0.25,
    baselineKgCO2PerKwh: 0.279,
    windowFrom: new Date('2026-03-01T00:00:00Z'),
    windowTo: new Date('2026-03-31T00:00:00Z'),
  };
  return {
    ...base,
    ...overrides,
    baseline: { ...base.baseline, ...(overrides.baseline ?? {}) },
    measurement: { ...base.measurement, ...(overrides.measurement ?? {}) },
  };
}

describe('EnergyBaselineService.ensureSchema', () => {
  it('ensureSchema idempotent — calling twice succeeds', async () => {
    await expect(EnergyBaselineService.ensureSchema()).resolves.not.toThrow();
    await expect(EnergyBaselineService.ensureSchema()).resolves.not.toThrow();
  });
});

describe('computeSavings pure math', () => {
  it('computeSavings: same-period comparison returns 0% (within rounding)', () => {
    const result = _computeSavingsFromScalars(makeScalarsInput());
    expect(result.deltaPct).toBeCloseTo(0, 2);
    expect(result.measurementEnpi).toBeCloseTo(0.5, 3);
    expect(result.baselineEnpi).toBeCloseTo(0.5, 3);
  });

  it('computeSavings: 10%-lower measurement returns -10% deltaPct (within rounding)', () => {
    // Baseline: 100 kWh / 200 kg = 0.5 kWh/kg
    // Measurement: 90 kWh / 200 kg = 0.45 kWh/kg → (0.45 - 0.5) / 0.5 * 100 = -10
    const result = _computeSavingsFromScalars(
      makeScalarsInput({ measurement: { totalKwh: 90, totalKg: 200 } }),
    );
    expect(result.deltaPct).toBeCloseTo(-10, 1);
    expect(result.deltaKwh).toBeCloseTo(-10, 1); // 90 - 0.5*200 = -10
    expect(result.deltaEur).toBeCloseTo(-10 * 0.25, 2);
    expect(result.deltaKgco2).toBeCloseTo(-10 * 0.279, 2);
  });

  it('computeSavings: measurement_from < baseline period_to throws BASELINE_OVERLAP', () => {
    expect(() =>
      _validateSavingsWindows({
        baselinePeriodTo: new Date('2026-03-15T00:00:00Z'),
        measurementFrom: new Date('2026-03-10T00:00:00Z'),
        measurementTo: new Date('2026-04-10T00:00:00Z'),
      }),
    ).toThrow(BaselineOverlapError);
  });

  it('computeSavings: empty normalization_variables returns confidence=LOW', () => {
    const result = _computeSavingsFromScalars(
      makeScalarsInput({
        baseline: {
          baselineId: 1,
          label: 'test baseline',
          enpi: 0.5,
          totalKwh: 100,
          totalKg: 200,
          normalizationVariables: {},
          periodFrom: new Date('2026-01-01T00:00:00Z'),
          periodTo: new Date('2026-01-31T00:00:00Z'),
        },
      }),
    );
    expect(result.confidence).toBe('LOW');
  });

  it('computeSavings: zero denominator throws MEASUREMENT_TOO_SHORT (Pitfall 5d guard)', () => {
    expect(() =>
      _computeSavingsFromScalars(makeScalarsInput({ measurement: { totalKwh: 0, totalKg: 0 } })),
    ).toThrow(MeasurementTooShortError);
  });

  it('computeSavings: deltaPct sign convention — negative means better than baseline', () => {
    // 10% less → -10 (better)
    const better = _computeSavingsFromScalars(
      makeScalarsInput({ measurement: { totalKwh: 90, totalKg: 200 } }),
    );
    expect(better.deltaPct).toBeLessThan(0);

    // 10% more → +10 (worse)
    const worse = _computeSavingsFromScalars(
      makeScalarsInput({ measurement: { totalKwh: 110, totalKg: 200 } }),
    );
    expect(worse.deltaPct).toBeGreaterThan(0);
    expect(worse.deltaPct).toBeCloseTo(10, 1);
  });
});

describe('_validateSavingsWindows extra rules', () => {
  it('_validateSavingsWindows: 6-day measurement window throws MEASUREMENT_TOO_SHORT', () => {
    expect(() =>
      _validateSavingsWindows({
        baselinePeriodTo: new Date('2026-01-31T00:00:00Z'),
        measurementFrom: new Date('2026-03-01T00:00:00Z'),
        measurementTo: new Date('2026-03-07T00:00:00Z'), // 6 days, too short
      }),
    ).toThrow(MeasurementTooShortError);
  });

  it('_validateSavingsWindows: exactly 7-day measurement window passes', () => {
    expect(() =>
      _validateSavingsWindows({
        baselinePeriodTo: new Date('2026-01-31T00:00:00Z'),
        measurementFrom: new Date('2026-03-01T00:00:00Z'),
        measurementTo: new Date('2026-03-08T00:00:00Z'), // exactly 7 days
      }),
    ).not.toThrow();
  });
});

describe('lockBaseline soft warnings', () => {
  it.todo('lockBaseline: cycle_count=19 in window returns warnings=[LOW_CYCLE_COUNT]');
  it.todo('lockBaseline: data_gap_ratio=0.051 returns warnings=[HIGH_DATA_GAP_RATIO]');
  it.todo('lockBaseline: cycle_count=20 AND data_gap_ratio=0.0499 returns warnings=[]');
});
