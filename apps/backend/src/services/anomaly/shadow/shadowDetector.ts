// ----------------------------------------------------------------------
// Phase 41: Shadow detector factory + config-diff helper (D-11, D-03)
// ----------------------------------------------------------------------
// Instantiates a second OnlineAnomalyDetector with stricter thresholds
// (false-positive scout pattern — DataRobot / Thoughtworks CD4ML). The
// OnlineAnomalyDetector CLASS is reused as-is; no subclass, no fork.
// Cloning primary's Welford/CUSUM state is explicitly forbidden (D-13
// textbook bias-leakage); shadow cold-starts every boot.

import {
  OnlineAnomalyDetector,
  type IDetectorConfig,
} from '../onlineAnomalyDetector.js';

/**
 * D-11: hardcoded stricter v1.4 defaults. Everything else inherits
 * primary factory defaults. NO env-var knobs in v1.4 — tuning happens
 * in v1.5 with real data.
 */
const SHADOW_CONFIG_OVERRIDES: Partial<IDetectorConfig> = {
  warningThreshold: 2.0,
  criticalThreshold: 3.0,
};

export function createShadowDetector(): OnlineAnomalyDetector {
  return new OnlineAnomalyDetector(SHADOW_CONFIG_OVERRIDES);
}

/**
 * D-03: compute the config diff for tuning_notes JSONB. Returns only
 * the keys whose values differ between primary and shadow. Empty object
 * when configs are identical (edge case: if shadow overrides ever align
 * with primary at runtime — not expected in v1.4).
 */
export function computeConfigDiff(
  primary: Required<IDetectorConfig>,
  shadow: Required<IDetectorConfig>,
): Record<string, { primary: number | boolean; shadow: number | boolean }> {
  const diff: Record<string, { primary: number | boolean; shadow: number | boolean }> = {};
  for (const key of Object.keys(shadow) as Array<keyof Required<IDetectorConfig>>) {
    const primaryValue = primary[key];
    const shadowValue = shadow[key];
    if (primaryValue !== shadowValue) {
      diff[key] = {
        primary: primaryValue as number | boolean,
        shadow: shadowValue as number | boolean,
      };
    }
  }
  return diff;
}
