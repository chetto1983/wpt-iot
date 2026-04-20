// ---------------------------------------------------------------------------
// ML Anomaly Detection — shared types (C9)
// ---------------------------------------------------------------------------

import { z } from 'zod/v4';

import { WsMessageType } from './enums.js';

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

// ---------------------------------------------------------------------------
// Phase 42: Detector introspection Zod mirrors (for debug state endpoint)
// ---------------------------------------------------------------------------
// Runtime-validatable mirrors of IDetectorFeatureSnapshot / IDetectorModeSnapshot /
// IDetectorSnapshot / IAnomalyContributor / IDetectorMetrics. The TS interfaces
// above stay as the primary type authority; these schemas are for
// fastify-type-provider-zod serialization + dev-only safeParse (D-15).

export const anomalyContributorSchema = z.object({
  feature: z.string(),
  zScore: z.number(),
  contribution: z.number().optional(),
  direction: z.enum(['HIGH', 'LOW']).optional(),
});

export const detectorMetricsSchema = z.object({
  totalObservations: z.number().int().nonnegative(),
  totalFlagged: z.number().int().nonnegative(),
  totalWarnings: z.number().int().nonnegative(),
  modesTracked: z.number().int().nonnegative(),
  warmModes: z.number().int().nonnegative(),
  uptimeMs: z.number().nonnegative(),
  gracePeriodsEntered: z.number().int().nonnegative(),
});

export const detectorFeatureSnapshotSchema = z.object({
  count: z.number().int().nonnegative(),
  mean: z.number(),
  emaMean: z.number(),
  m2: z.number(),
  decayedVariance: z.number(),
  sigma: z.number(),
});

export const detectorModeSnapshotSchema = z.object({
  samplesSeen: z.number().int().nonnegative(),
  enteredAt: z.number(),
  warm: z.boolean(),
  inGracePeriod: z.boolean(),
  cusum: z.object({
    posCumSum: z.number(),
    negCumSum: z.number(),
  }),
  recentFlags: z.array(z.boolean()),
  // D-14: features keyed alphabetically by caller; Zod does not enforce key
  // ordering, only presence + shape.
  features: z.record(z.string(), detectorFeatureSnapshotSchema),
});

export const detectorSnapshotSchema = z.object({
  currentModeKey: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  totalObservations: z.number().int().nonnegative(),
  totalFlagged: z.number().int().nonnegative(),
  config: z.record(z.string(), z.union([z.number(), z.boolean()])),
  metrics: detectorMetricsSchema,
  modes: z.record(z.string(), detectorModeSnapshotSchema),
});

// ---------------------------------------------------------------------------
// Phase 42 D-13: GET /api/anomaly/debug/state response envelope
// ---------------------------------------------------------------------------
// Envelope: { data: { primary, shadow }, meta: { generatedAt, isStale, lastObservationAt, detectorVersion } }.
// D-12: the non-primary section INTENTIONALLY OMITS a `contributors` key —
// Phase 41 D-07 narrowed the shadow service interface to forbid that field
// at the API boundary (see the structural omission inside the schema below).

export const debugStateResponseSchema = z.object({
  data: z.object({
    primary: z.object({
      snapshot: detectorSnapshotSchema,
      contributors: z.array(anomalyContributorSchema),
      metrics: detectorMetricsSchema,
    }),
    shadow: z.object({
      snapshot: detectorSnapshotSchema,
      metrics: detectorMetricsSchema,
      // contributors INTENTIONALLY OMITTED (D-12, Phase 41 D-07)
    }),
  }),
  meta: z.object({
    generatedAt: z.string().datetime(),
    isStale: z.boolean(),
    lastObservationAt: z.string().datetime().nullable(),
    detectorVersion: z.string(),
  }),
});

export type IDebugStateResponse = z.infer<typeof debugStateResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 42 D-02: POST /api/anomaly/debug/replay request + response
// ---------------------------------------------------------------------------
// maxRows ceiling of 200_000 is a defensive upper bound; cursor pagination
// makes large windows tractable but not free.

export const replayStartRequestSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  maxRows: z.number().int().positive().max(200_000).optional(),
  topN: z.number().int().positive().max(100).optional(),
});

export type IReplayStartRequest = z.infer<typeof replayStartRequestSchema>;

export const replayStartResponseSchema = z.object({
  streamId: z.string().min(1),
});

export type IReplayStartResponse = z.infer<typeof replayStartResponseSchema>;

// ---------------------------------------------------------------------------
// Phase 42 D-03: WsMessageType.REPLAY_FRAME envelope
// ---------------------------------------------------------------------------
// Discriminated union on `phase`: 'progress' | 'chunk' | 'error' | 'end'.
// seq is monotonic per streamId (starts at 0, increments on each emit) so
// clients can detect drops. 'error' and 'end' are terminal — no more frames
// with the same streamId follow.

const replayFrameBaseShape = {
  type: z.literal(WsMessageType.REPLAY_FRAME),
  streamId: z.string().min(1),
  seq: z.number().int().nonnegative(),
} as const;

const replayChunkRowSchema = z.object({
  observedAt: z.string().datetime(),
  modeKey: z.string(),
  score: z.number(),
  flagged: z.boolean(),
  topContributors: z.array(anomalyContributorSchema),
});

export const replayFrameSchema = z.discriminatedUnion('phase', [
  z.object({
    ...replayFrameBaseShape,
    phase: z.literal('progress'),
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    etaMs: z.number().nonnegative(),
  }),
  z.object({
    ...replayFrameBaseShape,
    phase: z.literal('chunk'),
    rows: z.array(replayChunkRowSchema),
  }),
  z.object({
    ...replayFrameBaseShape,
    phase: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    ...replayFrameBaseShape,
    phase: z.literal('end'),
    processed: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    ok: z.literal(true),
  }),
]);

export type IReplayFrame = z.infer<typeof replayFrameSchema>;
