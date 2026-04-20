import { describe, expect, it } from 'vitest';
import { createShadowDetector, computeConfigDiff } from '../../services/anomaly/shadow/shadowDetector.js';

describe('shadowDetector smoke', () => {
  it('createShadowDetector() config has warningThreshold=2.0 and criticalThreshold=3.0 (D-11)', () => {
    const cfg = createShadowDetector().getConfig();
    expect(cfg.warningThreshold).toBe(2.0);
    expect(cfg.criticalThreshold).toBe(3.0);
  });

  it('computeConfigDiff returns {} when configs are identical', () => {
    const cfg = createShadowDetector().getConfig();
    expect(computeConfigDiff(cfg, cfg)).toEqual({});
  });
});
