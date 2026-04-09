/**
 * Phase 20 — energyBaselineService unit tests
 *
 * RED-by-design scaffold (Wave 0 / Plan 00).
 * Every `it.todo(...)` reserves a test name that Plan 02 (pure math) or
 * Plan 03 (lockBaseline + soft warnings) will later implement and turn green.
 *
 * Test names are VERBATIM from 20-CONTEXT.md §specifics lines 210-222 and
 * 20-VALIDATION.md `-t` filter strings. Do not rename without re-syncing both files.
 *
 * No DB. No beforeEach. No pool.end(). Pure in-memory fixtures when Plan 02/03 land.
 *
 * Imports are intentionally commented out until Plan 01 ships the types + service shell.
 */

import { describe, it, expect } from 'vitest';
import { EnergyBaselineService } from '../services/energyBaselineService.js';

// TODO Plan 02/03: uncomment once pure-math and lockBaseline impls land
// import {
//   _computeSavingsFromScalars,
//   _computeSoftWarnings,
//   _validateSavingsWindows,
//   BaselineOverlapError,
//   MeasurementTooShortError,
// } from '../services/energyBaselineService.js';

describe('EnergyBaselineService.ensureSchema', () => {
  it('ensureSchema idempotent — calling twice succeeds', async () => {
    await expect(EnergyBaselineService.ensureSchema()).resolves.not.toThrow();
    await expect(EnergyBaselineService.ensureSchema()).resolves.not.toThrow();
  });
});

describe('computeSavings pure math', () => {
  it.todo('computeSavings: same-period comparison returns 0% (within rounding)');
  it.todo('computeSavings: 10%-lower measurement returns -10% deltaPct (within rounding)');
  it.todo('computeSavings: measurement_from < baseline period_to throws BASELINE_OVERLAP');
  it.todo('computeSavings: empty normalization_variables returns confidence=LOW');
  it.todo('computeSavings: zero denominator throws MEASUREMENT_TOO_SHORT (Pitfall 5d guard)');
  it.todo('computeSavings: deltaPct sign convention — negative means better than baseline');
});

describe('lockBaseline soft warnings', () => {
  it.todo('lockBaseline: cycle_count=19 in window returns warnings=[LOW_CYCLE_COUNT]');
  it.todo('lockBaseline: data_gap_ratio=0.051 returns warnings=[HIGH_DATA_GAP_RATIO]');
  it.todo('lockBaseline: cycle_count=20 AND data_gap_ratio=0.0499 returns warnings=[]');
});
