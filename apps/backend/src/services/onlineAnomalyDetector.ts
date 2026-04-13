/**
 * Enhanced online anomaly detector for machine telemetry.
 *
 * Improvements over the original prototype (see ML_IMPROVEMENT_PLAN.md):
 *  - Welford's numerically-stable online variance
 *  - Adaptive learning rate that decays with sample count
 *  - Exponential variance decay for concept drift
 *  - Transition grace period after mode changes
 *  - Multi-level thresholds (warning / critical)
 *  - Sample-confidence weighting (ramp-up scoring)
 *  - State serialization / deserialization for persistence
 *  - Detection metrics for monitoring
 *
 * The detector remains mode-aware (`selectedCycle/currentPhase/machineStatus`)
 * and requires no external ML runtime.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IAnomalyInput {
  selectedCycle: number | null;
  currentPhase: number | null;
  machineStatus: number | null;
  garbageTemp?: number | null;
  chamberPressure?: number | null;
  mainMotorSpeed?: number | null;
  mainMotorCurrent?: number | null;
  mainMotorTorque?: number | null;
  vacuumPumpSpeed01?: number | null;
  energyConsumption?: number | null;
  rmsCurrL1?: number | null;
  rmsCurrL2?: number | null;
  rmsCurrL3?: number | null;
  materialInputWeight?: number | null;
  materialOutputWeight?: number | null;
}

export enum AnomalyLevel {
  NORMAL = 'normal',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export interface IAnomalyResult {
  modeKey: string;
  warm: boolean;
  sampleCount: number;
  score: number;
  /** Confidence factor [0..1] based on sample count relative to minReliableSamples. */
  confidence: number;
  /** Whether the score is within a mode-change grace period. */
  inGracePeriod: boolean;
  level: AnomalyLevel;
  flagged: boolean;
  topContributors: Array<{ feature: string; zScore: number }>;
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

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface IWelfordState {
  count: number;
  /** Exact running mean — used ONLY for Welford M2 math. Never touch outside Welford step. */
  mean: number;
  /** EMA-tracked mean — adaptive reference for z-score computation. */
  emaMean: number;
  m2: number;
  decayedVariance: number;
}

interface IModeState {
  samplesSeen: number;
  features: Map<string, IWelfordState>;
  /** Timestamp (ms since epoch) when this mode was first entered. */
  enteredAt: number;
}

// ---------------------------------------------------------------------------
// Serialisable shapes
// ---------------------------------------------------------------------------

export interface ISerializedWelfordState {
  count: number;
  mean: number;
  emaMean: number;
  m2: number;
  decayedVariance: number;
}

export interface ISerializedModeState {
  samplesSeen: number;
  features: Record<string, ISerializedWelfordState>;
  enteredAt: number;
}

export interface ISerializedDetector {
  modes: Record<string, ISerializedModeState>;
  config: IDetectorConfig;
  startedAt: string | null;
  totalObservations: number;
  totalFlagged: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface IDetectorConfig {
  /** Minimum samples before a mode is considered "warm" (default 30). */
  minWarmSamples?: number;
  /** Minimum samples for full statistical confidence (default 200). */
  minReliableSamples?: number;
  /** Z-score threshold for WARNING level (default 2.5). */
  warningThreshold?: number;
  /** Z-score threshold for CRITICAL level (default 3.5). */
  criticalThreshold?: number;
  /**
   * Base learning rate for EMA updates.
   * When adaptiveRate is true this is the *maximum* rate.
   * (default 0.08)
   */
  baseRate?: number;
  /** Variance decay factor per step (0–1, default 0.999). */
  varianceDecayFactor?: number;
  /** Use adaptive learning rate (default true). */
  adaptiveRate?: boolean;
  /** Quarantine threshold multiplier (default 1.5). */
  quarantineMultiplier?: number;
  /** Cap per-feature z-score (default 25). */
  maxFeatureZScore?: number;
  /** How many top contributors contribute to the anomaly score (default 3). */
  topK?: number;
  /** Grace period in ms after a mode change (default 30 000). */
  modeChangeGraceMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUMERIC_FEATURES = [
  'garbageTemp',
  'chamberPressure',
  'mainMotorSpeed',
  'mainMotorCurrent',
  'mainMotorTorque',
  'vacuumPumpSpeed01',
  'energyConsumption',
  'rmsCurrL1',
  'rmsCurrL2',
  'rmsCurrL3',
  'materialInputWeight',
  'materialOutputWeight',
] as const;

const EPSILON = 1e-6;

/**
 * Correlated feature groups — take max z-score per group before top-K
 * to prevent a single electrical anomaly from inflating the composite
 * score by occupying all K slots (FIX 8).
 */
const FEATURE_GROUPS: ReadonlyArray<readonly string[]> = [
  ['rmsCurrL1', 'rmsCurrL2', 'rmsCurrL3'],
] as const;

/** Inverted index: feature name → group index (undefined = ungrouped). */
const FEATURE_TO_GROUP = new Map<string, number>();
for (let gi = 0; gi < FEATURE_GROUPS.length; gi++) {
  const group = FEATURE_GROUPS[gi];
  if (!group) continue;
  for (const f of group) {
    FEATURE_TO_GROUP.set(f, gi);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toModeKey(input: IAnomalyInput): string {
  return [
    input.selectedCycle ?? 'na',
    input.currentPhase ?? 'na',
    input.machineStatus ?? 'na',
  ].join(':');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function welfordVariance(state: IWelfordState): number {
  if (state.count < 2) return 1;
  return state.m2 / (state.count - 1);
}

// ---------------------------------------------------------------------------
// OnlineAnomalyDetector
// ---------------------------------------------------------------------------

export class OnlineAnomalyDetector {
  private readonly modes = new Map<string, IModeState>();
  private readonly config: Required<IDetectorConfig>;

  // Mode-change tracking for grace period
  private currentModeKey: string | null = null;
  private gracePeriodsEntered = 0;

  // Metrics
  private startedAt: Date | null = null;
  private totalObservations = 0;
  private totalFlagged = 0;
  private totalWarnings = 0;

  constructor(opts: IDetectorConfig = {}) {
    this.config = {
      minWarmSamples: opts.minWarmSamples ?? 30,
      minReliableSamples: opts.minReliableSamples ?? 200,
      warningThreshold: opts.warningThreshold ?? 2.5,
      criticalThreshold: opts.criticalThreshold ?? 3.5,
      baseRate: opts.baseRate ?? 0.08,
      varianceDecayFactor: opts.varianceDecayFactor ?? 0.999,
      adaptiveRate: opts.adaptiveRate ?? true,
      quarantineMultiplier: opts.quarantineMultiplier ?? 1.5,
      maxFeatureZScore: opts.maxFeatureZScore ?? 25,
      topK: opts.topK ?? 3,
      modeChangeGraceMs: opts.modeChangeGraceMs ?? 30_000,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private sampleConfidence(sampleCount: number): number {
    if (sampleCount >= this.config.minReliableSamples) return 1.0;
    return Math.min(sampleCount / this.config.minReliableSamples, 1.0);
  }

  private classifyLevel(
    effectiveScore: number,
    inGracePeriod: boolean,
  ): { level: AnomalyLevel; flagged: boolean } {
    if (effectiveScore >= this.config.criticalThreshold) {
      return { level: AnomalyLevel.CRITICAL, flagged: true };
    }
    if (effectiveScore >= this.config.warningThreshold) {
      return { level: AnomalyLevel.WARNING, flagged: !inGracePeriod };
    }
    return { level: AnomalyLevel.NORMAL, flagged: false };
  }

  private isGracePeriod(mode: IModeState): boolean {
    return mode.enteredAt > 0 && Date.now() - mode.enteredAt < this.config.modeChangeGraceMs;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Score an input without updating state. */
  score(input: IAnomalyInput): IAnomalyResult {
    const modeKey = toModeKey(input);
    const mode = this.modes.get(modeKey) ?? {
      samplesSeen: 0,
      features: new Map<string, IWelfordState>(),
      enteredAt: 0,
    };

    const inGracePeriod = this.isGracePeriod(mode);
    const confidence = this.sampleConfidence(mode.samplesSeen);

    const contributors: Array<{ feature: string; zScore: number }> = [];

    for (const feature of NUMERIC_FEATURES) {
      const value = input[feature];
      if (!isFiniteNumber(value)) continue;

      const state = mode.features.get(feature);
      if (!state || state.count < 2) continue;

      const sigma = Math.sqrt(Math.max(state.decayedVariance, EPSILON));
      const rawZScore = Math.abs((value - state.emaMean) / sigma);
      const zScore = Number.isFinite(rawZScore)
        ? Math.min(rawZScore, this.config.maxFeatureZScore)
        : this.config.maxFeatureZScore;
      contributors.push({ feature, zScore });
    }

    // FIX 8: Group correlated features — take max per group before top-K
    // to prevent one electrical anomaly from inflating the score by N×.
    const groupMax = new Map<number, { feature: string; zScore: number }>();
    const ungrouped: Array<{ feature: string; zScore: number }> = [];

    for (const c of contributors) {
      const gi = FEATURE_TO_GROUP.get(c.feature);
      if (gi != null) {
        const prev = groupMax.get(gi);
        if (!prev || c.zScore > prev.zScore) {
          groupMax.set(gi, c);
        }
      } else {
        ungrouped.push(c);
      }
    }

    const deduped = [...groupMax.values(), ...ungrouped];
    deduped.sort((a, b) => b.zScore - a.zScore);
    const topContributors = deduped.slice(0, this.config.topK);
    const rawScore =
      topContributors.length === 0
        ? 0
        : topContributors.reduce((sum, item) => sum + item.zScore, 0) / topContributors.length;

    const score = rawScore * confidence;
    const warm = mode.samplesSeen >= this.config.minWarmSamples;
    const { level, flagged } = this.classifyLevel(score, inGracePeriod);

    return {
      modeKey,
      warm,
      sampleCount: mode.samplesSeen,
      score,
      confidence,
      inGracePeriod,
      level,
      flagged: warm && flagged,
      topContributors,
    };
  }

  /** Observe a data point: score it, then optionally update internal statistics. */
  observe(input: IAnomalyInput): IAnomalyResult {
    if (!this.startedAt) this.startedAt = new Date();

    const modeKey = toModeKey(input);

    // Detect mode transition for grace period
    const modeChanged = this.currentModeKey !== null && this.currentModeKey !== modeKey;
    if (modeChanged) {
      this.gracePeriodsEntered += 1;
    }
    this.currentModeKey = modeKey;

    // Ensure mode exists
    let mode = this.modes.get(modeKey);
    if (!mode) {
      mode = { samplesSeen: 0, features: new Map<string, IWelfordState>(), enteredAt: Date.now() };
      this.modes.set(modeKey, mode);
    } else if (modeChanged) {
      // Reset grace period on every re-entry, not just first creation
      mode.enteredAt = Date.now();
    }

    // Score first (read-only)
    const result = this.score(input);

    // Quarantine: during grace period, use tighter threshold to reject
    // transition spikes. Normal mode uses the wider multiplier.
    const quarantineThreshold = result.inGracePeriod
      ? this.config.warningThreshold
      : this.config.criticalThreshold * this.config.quarantineMultiplier;

    const shouldUpdate = result.score < quarantineThreshold || !result.warm;

    if (shouldUpdate) {
      for (const feature of NUMERIC_FEATURES) {
        const value = input[feature];
        if (!isFiniteNumber(value)) continue;

        let state = mode.features.get(feature);
        if (!state) {
          state = { count: 1, mean: value, emaMean: value, m2: 0, decayedVariance: 1 };
          mode.features.set(feature, state);
          continue;
        }

        // Welford online update — canonical form (count first)
        state.count += 1;
        const delta = value - state.mean;
        state.mean += delta / state.count;
        const delta2 = value - state.mean;
        state.m2 += delta * delta2;

        // Adaptive learning rate
        const alpha = this.config.adaptiveRate
          ? this.config.baseRate / (1 + this.config.baseRate * state.count)
          : this.config.baseRate;

        // Exponential variance decay
        const currentVariance = welfordVariance(state);
        state.decayedVariance =
          this.config.varianceDecayFactor * state.decayedVariance +
          (1 - this.config.varianceDecayFactor) * currentVariance;

        // EMA blend — updates emaMean only, never touches Welford mean
        if (alpha > 0 && state.count > 1) {
          state.emaMean = (1 - alpha) * state.emaMean + alpha * value;
        }
      }
      mode.samplesSeen += 1;
    }

    this.totalObservations += 1;

    // Recompute classification after potential update
    const warm = mode.samplesSeen >= this.config.minWarmSamples;
    const confidence = this.sampleConfidence(mode.samplesSeen);
    const inGracePeriod = this.isGracePeriod(mode);

    // Re-score with updated statistics for accurate classification
    const updatedScore = this.score(input);
    const { level, flagged } = this.classifyLevel(updatedScore.score, inGracePeriod);
    const finalFlagged = warm && flagged;

    if (finalFlagged) this.totalFlagged += 1;
    if (level === AnomalyLevel.WARNING) this.totalWarnings += 1;

    return {
      modeKey,
      warm,
      sampleCount: mode.samplesSeen,
      score: updatedScore.score,
      confidence,
      inGracePeriod,
      level,
      flagged: finalFlagged,
      topContributors: updatedScore.topContributors,
    };
  }

  // -----------------------------------------------------------------------
  // Metrics
  // -----------------------------------------------------------------------

  getMetrics(): IDetectorMetrics {
    let warmModes = 0;
    for (const mode of this.modes.values()) {
      if (mode.samplesSeen >= this.config.minWarmSamples) warmModes++;
    }
    return {
      totalObservations: this.totalObservations,
      totalFlagged: this.totalFlagged,
      totalWarnings: this.totalWarnings,
      modesTracked: this.modes.size,
      warmModes,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      gracePeriodsEntered: this.gracePeriodsEntered,
    };
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  toJSON(): ISerializedDetector {
    const modes: Record<string, ISerializedModeState> = {};
    for (const [key, mode] of this.modes) {
      const features: Record<string, ISerializedWelfordState> = {};
      for (const [fname, fstate] of mode.features) {
        features[fname] = { ...fstate };
      }
      modes[key] = { samplesSeen: mode.samplesSeen, features, enteredAt: mode.enteredAt };
    }
    return {
      modes,
      config: { ...this.config },
      startedAt: this.startedAt?.toISOString() ?? null,
      totalObservations: this.totalObservations,
      totalFlagged: this.totalFlagged,
    };
  }

  static fromJSON(data: ISerializedDetector): OnlineAnomalyDetector {
    const detector = new OnlineAnomalyDetector(data.config);
    detector.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    detector.totalObservations = data.totalObservations ?? 0;
    detector.totalFlagged = data.totalFlagged ?? 0;

    for (const [modeKey, modeData] of Object.entries(data.modes)) {
      const features = new Map<string, IWelfordState>();
      for (const [fname, fdata] of Object.entries(modeData.features)) {
        // Backward-compat: old serialized states lack emaMean
        features.set(fname, { ...fdata, emaMean: fdata.emaMean ?? fdata.mean });
      }
      detector.modes.set(modeKey, {
        samplesSeen: modeData.samplesSeen,
        features,
        enteredAt: modeData.enteredAt ?? 0,
      });
    }
    return detector;
  }

  // -----------------------------------------------------------------------
  // Test helpers
  // -----------------------------------------------------------------------

  reset(): void {
    this.modes.clear();
    this.currentModeKey = null;
    this.gracePeriodsEntered = 0;
    this.startedAt = null;
    this.totalObservations = 0;
    this.totalFlagged = 0;
    this.totalWarnings = 0;
  }
}