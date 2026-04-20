// ---------------------------------------------------------------------------
// ML Anomaly Detection — shared types (C9)
// ---------------------------------------------------------------------------

import { z } from 'zod/v4';

export type AnomalyLevel = 'normal' | 'warning' | 'critical';
export type AnomalyEventStatus = 'OPEN' | 'ACKNOWLEDGED' | 'CONFIRMED' | 'DISMISSED' | 'CLOSED';
export type ResolutionCategory = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'PLANNED_MAINTENANCE' | 'SENSOR_FAULT';

export interface IAnomalyContributor {
  feature: string;
  zScore: number;
  /** Phase 40: squared-z share of total — z_i^2 / sum_deduped(z_j^2). Sums to 1.0 across reported contributors.
   *  Absent in pre-Phase-40 persisted JSONB rows (machine_anomaly_events.top_contributors). */
  contribution?: number;
  /** Phase 40: sign of (value - emaMean) at the deviation site — 'HIGH' when value > emaMean, 'LOW' when value < emaMean.
   *  Absent in pre-Phase-40 persisted JSONB rows (cannot be reconstructed from historical data). */
  direction?: 'HIGH' | 'LOW';
}

export interface IAnomalyResult {
  modeKey: string;
  warm: boolean;
  sampleCount: number;
  score: number;
  confidence: number;
  inGracePeriod: boolean;
  level: AnomalyLevel;
  flagged: boolean;
  driftDetected: boolean;
  topContributors: IAnomalyContributor[];
}

export interface IDetectorMetrics {
  totalObservations: number;
  totalFlagged: number;
  totalWarnings: number;
  modesTracked: number;
  warmModes: number;
  uptimeMs: number;
  gracePeriodsEntered: number;
}

export interface IAnomalyTrackingStatus {
  active: boolean;
  continuousLearning: true;
  persistsAcrossRestart: boolean;
  startedAt: string | null;
  observationCount: number;
  lastObservedAt: string | null;
  detectorMetrics: IDetectorMetrics;
}

export interface ILiveAnomalyState extends IAnomalyResult {
  observedAt: string;
}

export interface IMachineAnomalyEvent {
  id: number;
  observedAt: string;
  modeKey: string;
  score: number;
  flagged: boolean;
  warm: boolean;
  sampleCount: number;
  topContributors: IAnomalyContributor[];
  status: AnomalyEventStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolutionCategory: ResolutionCategory | null;
  createdAt: string;
}

export interface IAnomalyLiveResponse {
  tracking: IAnomalyTrackingStatus;
  latest: ILiveAnomalyState | null;
}

export interface IAnomalyEventsResponse {
  events: IMachineAnomalyEvent[];
}

// ---------------------------------------------------------------------------
// Phase 40: Detector introspection projection (for inspect() + debug API)
// ---------------------------------------------------------------------------

/** Phase 40: Recursive readonly for snapshot return types — prevents caller from
 *  mutating the introspection projection at compile time. Paired with
 *  fresh-object construction at runtime (no Object.freeze, no structuredClone). */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

export interface IDetectorFeatureSnapshot {
  count: number;
  mean: number;
  emaMean: number;
  m2: number;
  decayedVariance: number;
  /** Derived: sqrt(max(decayedVariance, EPSILON)). Included for debug consumers to avoid duplicating the math. */
  sigma: number;
}

export interface IDetectorModeSnapshot {
  samplesSeen: number;
  enteredAt: number;
  warm: boolean;
  inGracePeriod: boolean;
  cusum: { posCumSum: number; negCumSum: number };
  recentFlags: boolean[];
  features: Record<string, IDetectorFeatureSnapshot>;
}

export interface IDetectorSnapshot {
  currentModeKey: string | null;
  startedAt: string | null;
  totalObservations: number;
  totalFlagged: number;
  /** Resolved detector config (defaults applied). Number/boolean only — not a full IDetectorConfig to avoid cross-package leak of detector-internal config type. */
  config: Record<string, number | boolean>;
  metrics: IDetectorMetrics;
  modes: Record<string, IDetectorModeSnapshot>;
}

// ---------------------------------------------------------------------------
// Phase 41: Branded anomaly event types (D-06, SHADOW-03)
// ---------------------------------------------------------------------------
// Phantom symbol zones — erased at runtime, enforced at compile time.
// Broadcaster signatures narrow their input to PrimaryAnomalyEvent only;
// TS rejects passing a ShadowAnomalyEvent value at every call site.
// Zero runtime cost.

declare const PRIMARY_ZONE: unique symbol;
declare const SHADOW_ZONE: unique symbol;

export type PrimaryAnomalyEvent = IMachineAnomalyEvent & {
  readonly __zone: typeof PRIMARY_ZONE;
};

export type ShadowAnomalyEvent = Omit<
  IMachineAnomalyEvent,
  'status' | 'resolvedBy' | 'resolvedAt' | 'resolutionNote' | 'resolutionCategory'
> & {
  readonly __zone: typeof SHADOW_ZONE;
  readonly detectorVariant: string;
  readonly tuningNotes: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Phase 41: Shadow-vs-primary diff response (D-21, D-23)
// ---------------------------------------------------------------------------
// Response shape for GET /api/anomaly/shadow/diff.
// UNION ALL query + COUNT(*) FILTER (WHERE flagged) GROUP BY (variant, mode_key)
// — see routes/anomalyShadow.ts handler.

export const shadowDiffCountsSchema = z.object({
  flagged: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const shadowDiffByModeSchema = z.object({
  modeKey: z.string(),
  primary: shadowDiffCountsSchema,
  shadow: shadowDiffCountsSchema,
});

export const shadowDiffResponseSchema = z.object({
  totals: z.object({
    primary: shadowDiffCountsSchema,
    shadow: shadowDiffCountsSchema,
  }),
  byModeKey: z.array(shadowDiffByModeSchema),
  window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }),
});

export type IShadowDiffResponse = z.infer<typeof shadowDiffResponseSchema>;
