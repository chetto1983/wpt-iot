/**
 * Lightweight online anomaly detector prototype for machine telemetry.
 *
 * This is intentionally simple and repo-native:
 * - mode-aware (`selectedCycle/currentPhase/machineStatus`)
 * - one-pass online updates
 * - no heavy ML/runtime dependency
 *
 * It is a proof of concept for validating the product behavior before we
 * commit to a heavier streaming detector such as Half-Space Trees or RRCF.
 */

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

export interface IAnomalyResult {
  modeKey: string;
  warm: boolean;
  sampleCount: number;
  score: number;
  flagged: boolean;
  topContributors: Array<{ feature: string; zScore: number }>;
}

interface IFeatureState {
  mean: number;
  variance: number;
  initialized: boolean;
}

interface IModeState {
  samplesSeen: number;
  features: Map<string, IFeatureState>;
}

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

export class OnlineAnomalyDetector {
  private readonly modes = new Map<string, IModeState>();

  constructor(
    private readonly opts: {
      minWarmSamples?: number;
      scoreThreshold?: number;
      updateRate?: number;
      quarantineThreshold?: number;
    } = {},
  ) {}

  private get minWarmSamples(): number {
    return this.opts.minWarmSamples ?? 25;
  }

  private get scoreThreshold(): number {
    return this.opts.scoreThreshold ?? 3;
  }

  private get updateRate(): number {
    return this.opts.updateRate ?? 0.08;
  }

  private get quarantineThreshold(): number {
    return this.opts.quarantineThreshold ?? this.scoreThreshold * 1.5;
  }

  score(input: IAnomalyInput): IAnomalyResult {
    const modeKey = toModeKey(input);
    const mode = this.modes.get(modeKey) ?? {
      samplesSeen: 0,
      features: new Map<string, IFeatureState>(),
    };

    const contributors: Array<{ feature: string; zScore: number }> = [];

    for (const feature of NUMERIC_FEATURES) {
      const value = input[feature];
      if (!isFiniteNumber(value)) continue;

      const state = mode.features.get(feature);
      if (!state?.initialized) continue;

      const sigma = Math.sqrt(Math.max(state.variance, EPSILON));
      const zScore = Math.abs((value - state.mean) / sigma);
      contributors.push({ feature, zScore });
    }

    contributors.sort((a, b) => b.zScore - a.zScore);
    const topContributors = contributors.slice(0, 3);
    const score =
      topContributors.length === 0
        ? 0
        : topContributors.reduce((sum, item) => sum + item.zScore, 0) / topContributors.length;

    const warm = mode.samplesSeen >= this.minWarmSamples;
    return {
      modeKey,
      warm,
      sampleCount: mode.samplesSeen,
      score,
      flagged: warm && score >= this.scoreThreshold,
      topContributors,
    };
  }

  observe(input: IAnomalyInput): IAnomalyResult {
    const result = this.score(input);
    const modeKey = result.modeKey;
    let mode = this.modes.get(modeKey);
    if (!mode) {
      mode = { samplesSeen: 0, features: new Map<string, IFeatureState>() };
      this.modes.set(modeKey, mode);
    }

    // Do not immediately adapt on extreme spikes; they are more likely to be
    // the anomalies we want to surface rather than new baseline behavior.
    if (result.score < this.quarantineThreshold || !result.warm) {
      for (const feature of NUMERIC_FEATURES) {
        const value = input[feature];
        if (!isFiniteNumber(value)) continue;

        const current = mode.features.get(feature) ?? {
          mean: value,
          variance: 1,
          initialized: false,
        };

        if (!current.initialized) {
          current.mean = value;
          current.variance = 1;
          current.initialized = true;
          mode.features.set(feature, current);
          continue;
        }

        const alpha = this.updateRate;
        const delta = value - current.mean;
        current.mean += alpha * delta;
        current.variance =
          (1 - alpha) * current.variance + alpha * delta * delta;
        mode.features.set(feature, current);
      }
      mode.samplesSeen += 1;
    }

    return {
      ...result,
      sampleCount: mode.samplesSeen,
      warm: mode.samplesSeen >= this.minWarmSamples,
      flagged: mode.samplesSeen >= this.minWarmSamples && result.score >= this.scoreThreshold,
    };
  }
}
