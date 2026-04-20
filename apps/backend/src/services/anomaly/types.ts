/**
 * Anomaly domain shared types.
 * Extracted from machineAnomalyService.ts to break circular dependency
 * with machineAnomalyEventService.ts.
 */
import type { IAnomalyResult } from './onlineAnomalyDetector.js';

export interface ILiveAnomalyState extends IAnomalyResult {
  observedAt: string;
}

/**
 * Phase 41 Task 0 (ISSUE-01 fix): ILogger moved here from
 * machineAnomalyService.ts so shadow services can import it without reaching
 * back into the primary service module (which would create a service-layer
 * dependency loop). Byte-identical to the pre-edit local declaration — the
 * interface body is a structural contract, not a behavior change.
 */
export interface ILogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}
