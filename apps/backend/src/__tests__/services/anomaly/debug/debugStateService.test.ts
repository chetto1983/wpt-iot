// Phase 42 Plan 42-05 Task 1 -- D-24 unit test for DebugStateService.
// Pure-logic: fakes primary + non-primary service returns via vi.mock, asserts
// envelope shape, alphabetical feature sort, staleness calc at the 30s
// boundary, and structural absence of the live-contributor field on the
// non-primary section (D-12, Phase 41 D-07 absence-as-defense).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IDetectorSnapshot,
  ILiveAnomalyState,
  IAnomalyContributor,
  IDetectorMetrics,
  DeepReadonly,
} from '@wpt/types';

// ----- Fixtures -------------------------------------------------------------

const fakeMetrics: IDetectorMetrics = {
  totalObservations: 10,
  totalFlagged: 2,
  totalWarnings: 5,
  modesTracked: 1,
  warmModes: 1,
  uptimeMs: 60_000,
  gracePeriodsEntered: 0,
};

function makeFakeSnapshot(featureKeys: string[]): DeepReadonly<IDetectorSnapshot> {
  const features: Record<
    string,
    { count: number; mean: number; emaMean: number; m2: number; decayedVariance: number; sigma: number }
  > = {};
  for (const key of featureKeys) {
    features[key] = {
      count: 10,
      mean: 1.0,
      emaMean: 1.0,
      m2: 0.5,
      decayedVariance: 0.5,
      sigma: 0.7071,
    };
  }
  const snapshot: IDetectorSnapshot = {
    currentModeKey: '3:1:0',
    startedAt: '2026-04-20T10:00:00.000Z',
    totalObservations: 10,
    totalFlagged: 2,
    config: { warningThreshold: 2.5, criticalThreshold: 3.5 },
    metrics: fakeMetrics,
    modes: {
      '3:1:0': {
        samplesSeen: 10,
        enteredAt: Date.now(),
        warm: true,
        inGracePeriod: false,
        cusum: { posCumSum: 0, negCumSum: 0 },
        recentFlags: [false, false, true],
        features,
      },
    },
  };
  return snapshot as DeepReadonly<IDetectorSnapshot>;
}

// ----- Mocks ----------------------------------------------------------------

const getDetectorSnapshotMock = vi.fn<() => DeepReadonly<IDetectorSnapshot>>();
const getLatestMock = vi.fn<() => ILiveAnomalyState | null>();
const shadowInspectMock = vi.fn<() => DeepReadonly<IDetectorSnapshot>>();

vi.mock('../../../../services/anomaly/machineAnomalyService.js', () => ({
  machineAnomalyService: {
    getDetectorSnapshot: getDetectorSnapshotMock,
    getLatest: getLatestMock,
  },
}));

vi.mock('../../../../services/anomaly/shadow/machineShadowAnomalyService.js', () => ({
  machineShadowAnomalyService: {
    inspect: shadowInspectMock,
  },
}));

// Import AFTER vi.mock so the service binds to the mocked modules.
const { DebugStateService } = await import(
  '../../../../services/anomaly/debug/debugStateService.js'
);

// ---------------------------------------------------------------------------

describe('DebugStateService.assembleState', () => {
  beforeEach(() => {
    getDetectorSnapshotMock.mockReset();
    getLatestMock.mockReset();
    shadowInspectMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Envelope shape ------------------------------------------------------

  it('returns { data: { primary, shadow }, meta } envelope shape', () => {
    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    getLatestMock.mockReturnValue(null);

    const response = DebugStateService.assembleState();

    expect(response).toHaveProperty('data.primary');
    expect(response).toHaveProperty('data.shadow');
    expect(response).toHaveProperty('meta.generatedAt');
    expect(response).toHaveProperty('meta.isStale');
    expect(response).toHaveProperty('meta.lastObservationAt');
    expect(response).toHaveProperty('meta.detectorVersion');
  });

  it('data.primary has snapshot + contributors + metrics', () => {
    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    const latest: ILiveAnomalyState = {
      modeKey: '3:1:0',
      warm: true,
      sampleCount: 10,
      score: 2.8,
      confidence: 0.9,
      inGracePeriod: false,
      level: 'warning',
      flagged: true,
      driftDetected: false,
      topContributors: [
        { feature: 'energyConsumption', zScore: 3.0, contribution: 0.5, direction: 'HIGH' },
      ] satisfies IAnomalyContributor[],
      observedAt: new Date().toISOString(),
    };
    getLatestMock.mockReturnValue(latest);

    const response = DebugStateService.assembleState();
    expect(response.data.primary).toHaveProperty('snapshot');
    expect(response.data.primary).toHaveProperty('contributors');
    expect(response.data.primary).toHaveProperty('metrics');
    expect(response.data.primary.contributors).toHaveLength(1);
    expect(response.data.primary.contributors[0]).toMatchObject({
      feature: 'energyConsumption',
      contribution: 0.5,
      direction: 'HIGH',
    });
  });

  // --- D-12 shadow structurally omits the live-contributor field ----------

  it('data.shadow does NOT have a `contributors` key (D-12, Phase 41 D-07)', () => {
    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    getLatestMock.mockReturnValue(null);

    const response = DebugStateService.assembleState();
    expect(Object.keys(response.data.shadow)).not.toContain('contributors');
    expect(response.data.shadow).toHaveProperty('snapshot');
    expect(response.data.shadow).toHaveProperty('metrics');
  });

  // --- D-14 alphabetical feature sort -------------------------------------

  it('features within each mode are alphabetically sorted (D-14)', () => {
    // Insertion order zulu -> alpha -> mike; after sort: alpha, mike, zulu.
    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['zulu', 'alpha', 'mike']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['zulu', 'alpha', 'mike']));
    getLatestMock.mockReturnValue(null);

    const response = DebugStateService.assembleState();
    const primaryModeKeys = Object.keys(
      response.data.primary.snapshot.modes['3:1:0']!.features,
    );
    const shadowModeKeys = Object.keys(
      response.data.shadow.snapshot.modes['3:1:0']!.features,
    );
    expect(primaryModeKeys).toEqual(['alpha', 'mike', 'zulu']);
    expect(shadowModeKeys).toEqual(['alpha', 'mike', 'zulu']);
  });

  // --- D-13 staleness boundary at 30s -------------------------------------

  it('isStale is false when lastObservationAt is 29s in the past', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    getLatestMock.mockReturnValue({
      modeKey: '3:1:0',
      warm: true,
      sampleCount: 10,
      score: 1.0,
      confidence: 0.9,
      inGracePeriod: false,
      level: 'normal',
      flagged: false,
      driftDetected: false,
      topContributors: [],
      observedAt: new Date(now.getTime() - 29_000).toISOString(),
    });

    const response = DebugStateService.assembleState();
    expect(response.meta.isStale).toBe(false);
  });

  it('isStale is true when lastObservationAt is 31s in the past', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    getLatestMock.mockReturnValue({
      modeKey: '3:1:0',
      warm: true,
      sampleCount: 10,
      score: 1.0,
      confidence: 0.9,
      inGracePeriod: false,
      level: 'normal',
      flagged: false,
      driftDetected: false,
      topContributors: [],
      observedAt: new Date(now.getTime() - 31_000).toISOString(),
    });

    const response = DebugStateService.assembleState();
    expect(response.meta.isStale).toBe(true);
  });

  it('isStale is true when lastObservationAt is null (no observation yet)', () => {
    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    getLatestMock.mockReturnValue(null);

    const response = DebugStateService.assembleState();
    expect(response.meta.isStale).toBe(true);
    expect(response.meta.lastObservationAt).toBeNull();
  });

  // --- meta.detectorVersion + generatedAt ISO ------------------------------

  it('meta.detectorVersion is "v1.4" and generatedAt is a valid ISO string', () => {
    getDetectorSnapshotMock.mockReturnValue(makeFakeSnapshot(['a']));
    shadowInspectMock.mockReturnValue(makeFakeSnapshot(['a']));
    getLatestMock.mockReturnValue(null);

    const response = DebugStateService.assembleState();
    expect(response.meta.detectorVersion).toBe('v1.4');
    expect(() => new Date(response.meta.generatedAt).toISOString()).not.toThrow();
  });
});
