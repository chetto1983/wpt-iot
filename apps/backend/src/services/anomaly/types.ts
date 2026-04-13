/**
 * Anomaly domain shared types.
 * Extracted from machineAnomalyService.ts to break circular dependency
 * with machineAnomalyEventService.ts.
 */
import type { IAnomalyResult } from './onlineAnomalyDetector.js';

export interface ILiveAnomalyState extends IAnomalyResult {
  observedAt: string;
}
