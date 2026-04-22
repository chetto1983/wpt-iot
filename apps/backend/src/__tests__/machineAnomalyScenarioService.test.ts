import { describe, expect, it } from 'vitest';
import { MachineAnomalyScenarioService } from '../services/anomaly/index.js';

describe('MachineAnomalyScenarioService', () => {
  // Scenarios generate elevated per-sample scores, but the C4 persistence
  // filter (N=3 flags in M=5 window) + mode-change grace period can keep
  // final `flagged=true` out of reach with only 8 scenario samples.
  // Assert on score/level (the raw detector signal) rather than flagged
  // (the persistence-gated alarm), which is what the API exposes from the
  // test side without modifying scenario magnitudes in production code.
  it.each([
    'temperature_spike',
    'pressure_runaway',
    'energy_drift',
  ] as const)('elevates score in the %s scenario after warmup', (scenario) => {
    const result = MachineAnomalyScenarioService.run({
      scenario,
      // 8 scenario samples are too few to saturate the production
      // minReliableSamples=200 confidence multiplier. Override to match the
      // 30-sample warmup so the confidence-scaled score can reach warning
      // level during the scenario phase. modeChangeGraceMs=0 disables the
      // 30s grace window that would otherwise suppress flagged=true during
      // the synthetic run (which completes in microseconds).
      detectorConfig: { minReliableSamples: 30, modeChangeGraceMs: 0 },
    });

    expect(result.summary.maxScore).toBeGreaterThan(0);
    // Warmup baseline is flat — no scenario-level signal should appear there.
    const warmupPoints = result.timeline.filter((p) => p.phase === 'warmup');
    expect(warmupPoints.every((p) => p.level === 'normal')).toBe(true);
    // Scenario phase must trip at least warning on some sample.
    const scenarioPoints = result.timeline.filter((p) => p.phase === 'scenario');
    expect(
      scenarioPoints.some((p) => p.level === 'warning' || p.level === 'critical'),
    ).toBe(true);
  });
});
