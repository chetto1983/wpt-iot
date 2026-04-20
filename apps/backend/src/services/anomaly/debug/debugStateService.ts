// ----------------------------------------------------------------------
// Phase 42: Debug state assembler (DEBUG-01, DEBUG-02 — D-11..D-16)
// ----------------------------------------------------------------------
// Pure-logic service: reads primary + shadow detector introspection, builds
// the IDebugStateResponse envelope for GET /api/anomaly/debug/state. No DB,
// no framework binding, no mutable state. Unit-testable by injecting fake
// services via vi.mock (see 42-05 D-24).

import type {
  DeepReadonly,
  IAnomalyContributor,
  IDebugStateResponse,
  IDetectorFeatureSnapshot,
  IDetectorModeSnapshot,
  IDetectorSnapshot,
} from '@wpt/types';

import { machineAnomalyService } from '../machineAnomalyService.js';
import { machineShadowAnomalyService } from '../shadow/machineShadowAnomalyService.js';

/** D-13 staleness threshold: 2 × PLC 15 s cadence = 30 s. */
const STALE_THRESHOLD_MS = 30_000;

/** D-Discretion: detector schema version. Literal 'v1.4' per CONTEXT §Claude's Discretion.
 *  Refactor to package.json / git SHA if the frontend ever diff-compares this field. */
const DETECTOR_VERSION = 'v1.4';

/** D-14: features record has JS-engine insertion-order iteration. Alphabetical
 *  sort gives stable rendering + stable future WS-patch-diff semantics. */
function sortFeaturesAlphabetically(
  features: DeepReadonly<Record<string, IDetectorFeatureSnapshot>>,
): Record<string, IDetectorFeatureSnapshot> {
  const sorted: Record<string, IDetectorFeatureSnapshot> = {};
  for (const key of Object.keys(features).sort()) {
    // Spread to drop the DeepReadonly marker at the response boundary; the
    // shape stays structurally identical. No data is copied beyond primitives.
    sorted[key] = { ...features[key]! };
  }
  return sorted;
}

/** Rebuild a mode snapshot with alphabetically-sorted features. Preserves
 *  every other field verbatim (fresh-object construction discipline — same
 *  pattern used by OnlineAnomalyDetector.inspect()). */
function projectModeSnapshot(
  mode: DeepReadonly<IDetectorModeSnapshot>,
): IDetectorModeSnapshot {
  return {
    samplesSeen: mode.samplesSeen,
    enteredAt: mode.enteredAt,
    warm: mode.warm,
    inGracePeriod: mode.inGracePeriod,
    cusum: { posCumSum: mode.cusum.posCumSum, negCumSum: mode.cusum.negCumSum },
    recentFlags: [...mode.recentFlags],
    features: sortFeaturesAlphabetically(mode.features),
  };
}

/** Apply D-14 feature sort to every mode inside a detector snapshot. */
function projectDetectorSnapshot(
  snapshot: DeepReadonly<IDetectorSnapshot>,
): IDetectorSnapshot {
  const modes: Record<string, IDetectorModeSnapshot> = {};
  for (const [key, mode] of Object.entries(snapshot.modes)) {
    modes[key] = projectModeSnapshot(mode);
  }
  return {
    currentModeKey: snapshot.currentModeKey,
    startedAt: snapshot.startedAt,
    totalObservations: snapshot.totalObservations,
    totalFlagged: snapshot.totalFlagged,
    config: { ...snapshot.config },
    metrics: { ...snapshot.metrics },
    modes,
  };
}

/** D-13: isStale iff now - lastObservationAt > 30s. Null timestamp → stale. */
function computeIsStale(lastObservationAt: string | null, nowMs: number): boolean {
  if (lastObservationAt === null) return true;
  const observedMs = Date.parse(lastObservationAt);
  if (Number.isNaN(observedMs)) return true; // defensive — shouldn't happen given ISO input
  return (nowMs - observedMs) > STALE_THRESHOLD_MS;
}

/**
 * Phase 42 D-11..D-16: assemble the full /debug/state response envelope.
 * Static-only — no instance state, matches CLAUDE.md §Code Style convention
 * (cf. MachineShadowAnomalyEventService.getDiff).
 */
export class DebugStateService {
  static assembleState(): IDebugStateResponse {
    const now = Date.now();
    const primarySnapshot = machineAnomalyService.getDetectorSnapshot();
    const primaryLatest = machineAnomalyService.getLatest();
    const shadowSnapshot = machineShadowAnomalyService.inspect();

    const primaryContributors: IAnomalyContributor[] = primaryLatest?.topContributors ?? [];
    const lastObservationAt = primaryLatest?.observedAt ?? null;

    const response: IDebugStateResponse = {
      data: {
        primary: {
          snapshot: projectDetectorSnapshot(primarySnapshot),
          contributors: primaryContributors.map((c) => ({ ...c })),
          metrics: { ...primarySnapshot.metrics },
        },
        shadow: {
          snapshot: projectDetectorSnapshot(shadowSnapshot),
          metrics: { ...shadowSnapshot.metrics },
          // D-12: the non-primary section has NO corresponding live-contributor
          // field — Phase 41 D-07 narrowed the other-detector interface to
          // forbid that field at the API boundary. The absence here is
          // structural, not runtime-filtered.
        },
      },
      meta: {
        generatedAt: new Date(now).toISOString(),
        isStale: computeIsStale(lastObservationAt, now),
        lastObservationAt,
        detectorVersion: DETECTOR_VERSION,
      },
    };

    return response;
  }
}
