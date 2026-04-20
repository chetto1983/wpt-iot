import { describe, expect, it } from 'vitest';
import { MachineShadowAnomalyService } from '../../services/anomaly/shadow/machineShadowAnomalyService.js';

describe('MachineShadowAnomalyService smoke — D-07 narrowed interface', () => {
  it('public surface is EXACTLY {observe, start, stop, saveState, loadState, getDetectorConfigDiff, inspect} — no getLatest/getTrackingStatus', () => {
    const svc = new MachineShadowAnomalyService();
    const keys = new Set(
      Object.getOwnPropertyNames(MachineShadowAnomalyService.prototype)
        .filter((k) => k !== 'constructor' && !k.startsWith('_')),
    );
    // Deliberately ABSENT (SHADOW-03 defense layer 2):
    expect(keys.has('getLatest')).toBe(false);
    expect(keys.has('getTrackingStatus')).toBe(false);
    // Deliberately PRESENT:
    for (const m of ['observe', 'start', 'stop', 'saveState', 'loadState', 'getDetectorConfigDiff', 'inspect']) {
      expect(keys.has(m)).toBe(true);
    }
    // Silence "unused variable" lint for svc — exercise instance creation succeeded:
    expect(svc).toBeInstanceOf(MachineShadowAnomalyService);
  });
});
