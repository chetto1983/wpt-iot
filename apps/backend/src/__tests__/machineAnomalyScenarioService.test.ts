import { describe, expect, it } from 'vitest';
import { MachineAnomalyScenarioService } from '../services/anomaly/index.js';

describe('MachineAnomalyScenarioService', () => {
  it.each([
    'temperature_spike',
    'pressure_runaway',
    'energy_drift',
  ] as const)('flags the %s scenario after warmup', (scenario) => {
    const result = MachineAnomalyScenarioService.run({ scenario });

    expect(result.summary.anomalyFlags).toBeGreaterThan(0);
    expect(result.summary.firstFlaggedIndex).not.toBeNull();
    expect(result.timeline.some((point) => point.phase === 'warmup' && point.flagged)).toBe(false);
    expect(result.timeline.some((point) => point.phase === 'scenario' && point.flagged)).toBe(true);
  });
});
