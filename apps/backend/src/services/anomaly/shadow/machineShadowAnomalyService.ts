// ----------------------------------------------------------------------
// Phase 41: Machine Shadow Anomaly Service (SHADOW-01, SHADOW-02)
// ----------------------------------------------------------------------
// Second detector instance orchestrator. D-07 narrowed public interface —
// no getLatest(), no getTrackingStatus(). Broadcaster structurally cannot
// read live shadow state because the method doesn't exist. SHADOW-03
// defense layer 2.
//
// Lifecycle:
// - observe(input): D-16 primary invokes this after its own observe().
//   D-12 kill-switch: no-op when SHADOW_ENABLED=false.
//   D-18 try/catch: shadow throws NEVER propagate to primary.
// - saveState / loadState: separate file (D-14) — uploads/anomaly-shadow-state.json.
// - Cold start (D-13): state begins empty every boot; NO cloning from primary.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DeepReadonly, IDetectorSnapshot } from '@wpt/types';

import {
  OnlineAnomalyDetector,
  type IAnomalyInput,
  type ISerializedDetector,
} from '../onlineAnomalyDetector.js';
import { PERSIST_COOLDOWN_MS } from '../machineAnomalyService.js';
import type { ILogger, ILiveAnomalyState } from '../types.js';

import { createShadowDetector, computeConfigDiff } from './shadowDetector.js';
import { MachineShadowAnomalyEventService } from './machineShadowAnomalyEventService.js';

const STATE_FILE = path.resolve('uploads', 'anomaly-shadow-state.json');
const SHADOW_ENABLED = process.env.SHADOW_ENABLED !== 'false'; // D-12

export class MachineShadowAnomalyService {
  private detector: OnlineAnomalyDetector;
  private started = false;
  private observationCount = 0;
  private lastPersistedAtByMode = new Map<string, number>();
  private tuningNotesCache: Record<string, unknown> | null = null;

  constructor() {
    this.detector = createShadowDetector(); // D-13 cold-start — fresh state every boot
  }

  /**
   * D-16: primary invokes this after its own detector.observe().
   * D-18: try/catch — shadow throws never propagate; log at error, primary continues.
   * D-17: same 15-min per-mode cooldown as primary — symmetry keeps the diff honest.
   */
  observe(input: IAnomalyInput, log?: ILogger): void {
    if (!SHADOW_ENABLED) return; // D-12 kill-switch: silent no-op

    try {
      const result = this.detector.observe(input);
      this.observationCount += 1;

      const observedAtIso = new Date().toISOString();
      const state: ILiveAnomalyState = {
        ...result,
        observedAt: observedAtIso,
      };

      if (result.flagged && log) {
        log.info(
          {
            name: 'MachineAnomalyShadow',
            observedAt: observedAtIso,
            modeKey: result.modeKey,
            score: result.score,
            contributors: result.topContributors,
          },
          'Shadow anomaly detected',
        );
      }

      if (this.shouldPersistFlaggedEvent(state)) {
        this.lastPersistedAtByMode.set(state.modeKey, Date.parse(state.observedAt));
        const tuningNotes = this.getTuningNotes();
        void MachineShadowAnomalyEventService.recordEvent(state, tuningNotes).catch(
          (err: unknown) => {
            if (log) {
              log.error(
                { name: 'MachineAnomalyShadow', err: (err as Error).message },
                'Failed to persist shadow anomaly event',
              );
            }
          },
        );
      }
    } catch (err) {
      if (log) {
        log.error(
          { name: 'MachineAnomalyShadow', err: (err as Error).message },
          'Shadow observe failed (primary path unaffected)',
        );
      }
    }
  }

  private shouldPersistFlaggedEvent(state: ILiveAnomalyState): boolean {
    if (!state.flagged) return false;
    const observedAtMs = Date.parse(state.observedAt);
    const lastPersistedAt = this.lastPersistedAtByMode.get(state.modeKey);
    if (lastPersistedAt == null) return true;
    return observedAtMs - lastPersistedAt >= PERSIST_COOLDOWN_MS;
  }

  start(log: ILogger): void {
    if (this.started) return;
    this.started = true;
    log.info(
      {
        name: 'MachineAnomalyShadow',
        enabled: SHADOW_ENABLED,
        config: this.detector.getConfig(),
      },
      SHADOW_ENABLED
        ? 'Shadow anomaly service started (D-11 stricter thresholds 2.0/3.0)'
        : 'Shadow anomaly service instantiated but DISABLED via SHADOW_ENABLED=false',
    );
  }

  stop(): void {
    this.started = false;
  }

  async saveState(log: ILogger): Promise<void> {
    if (!SHADOW_ENABLED) return; // D-12: disabled = no state file churn
    try {
      const data = this.detector.toJSON();
      await writeFile(STATE_FILE, JSON.stringify(data), 'utf-8');
      log.info(
        { name: 'MachineAnomalyShadow', file: STATE_FILE, observations: data.totalObservations },
        'Shadow detector state saved to disk',
      );
    } catch (err) {
      log.error(
        { name: 'MachineAnomalyShadow', err: (err as Error).message },
        'Failed to save shadow detector state',
      );
    }
  }

  async loadState(log: ILogger): Promise<boolean> {
    if (!SHADOW_ENABLED) return false;
    try {
      const raw = await readFile(STATE_FILE, 'utf-8');
      const data = JSON.parse(raw) as ISerializedDetector;
      this.detector = OnlineAnomalyDetector.fromJSON(data);
      log.info(
        { name: 'MachineAnomalyShadow', file: STATE_FILE, observations: data.totalObservations },
        'Shadow detector state restored from disk',
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * D-03 source of truth: tuning_notes JSONB = computeConfigDiff(primary, shadow).
   * Cached lazily (primary config is an invariant at construction time in v1.4).
   */
  getDetectorConfigDiff(): Record<string, unknown> {
    return this.getTuningNotes();
  }

  private getTuningNotes(): Record<string, unknown> {
    if (this.tuningNotesCache !== null) return this.tuningNotesCache;
    // Throwaway instance to read primary's DEFAULT config for the diff baseline.
    // Constructor is cheap (initializes state maps only); invariant at v1.4.
    const primaryConfig = new OnlineAnomalyDetector().getConfig();
    const shadowConfig = this.detector.getConfig();
    this.tuningNotesCache = computeConfigDiff(primaryConfig, shadowConfig);
    return this.tuningNotesCache;
  }

  /**
   * Phase 42 SUPER_ADMIN debug surface. NOT a broadcast path — SHADOW-03
   * is about user-visible channels (ws/, mqtt/sparkplug*, routes/alarm*).
   * /debug/detector (Phase 42) reads this at the route layer only.
   */
  inspect(): DeepReadonly<IDetectorSnapshot> {
    return this.detector.inspect();
  }

  // Deliberately ABSENT (D-07, SHADOW-03 defense layer 2):
  // - getLatest(): no live-state accessor
  // - getTrackingStatus(): no observation-count accessor
  // A broadcaster that tries to call these gets a TS error at compile time.
}

export const machineShadowAnomalyService = new MachineShadowAnomalyService();
