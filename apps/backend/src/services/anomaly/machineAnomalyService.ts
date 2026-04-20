import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IMachineSnapshot } from '@wpt/types';
import { dataHub } from '../../events/hub.js';
import { DATA_EVENTS } from '../../events/types.js';
import { MachineAnomalyEventService } from './machineAnomalyEventService.js';
import type { ILiveAnomalyState, ILogger } from './types.js';
export type { ILiveAnomalyState } from './types.js';
import {
  OnlineAnomalyDetector,
  type IDetectorConfig,
  type IDetectorMetrics,
  type ISerializedDetector,
} from './onlineAnomalyDetector.js';

import { machineShadowAnomalyService } from './shadow/machineShadowAnomalyService.js';

const STATE_FILE = path.resolve('uploads', 'anomaly-state.json');

/**
 * Phase 41 Task 0 (D-17): single source of truth for the 15-min per-mode
 * persist cooldown. Imported by the shadow service at
 * services/anomaly/shadow/machineShadowAnomalyService.ts so both detector
 * paths share the exact same literal. Changing here changes both, keeping
 * the SHADOW-04 diff endpoint honest (asymmetric cooldowns would make
 * shadow's count trivially exceed primary's, turning the diff into noise).
 */
export const PERSIST_COOLDOWN_MS = 15 * 60 * 1000;

interface IAnomalyTrackingStatus {
  active: boolean;
  continuousLearning: true;
  persistsAcrossRestart: boolean;
  startedAt: string | null;
  observationCount: number;
  lastObservedAt: string | null;
  detectorMetrics: IDetectorMetrics;
}

function mapSnapshotToDetectorInput(snapshot: IMachineSnapshot) {
  return {
    selectedCycle: snapshot.selectedCycle ?? null,
    currentPhase: snapshot.currentPhase ?? null,
    machineStatus: snapshot.machineStatus ?? null,
    garbageTemp: snapshot.garbageTemp ?? null,
    chamberPressure: snapshot.chamberPressure ?? null,
    mainMotorSpeed: snapshot.mainMotorSpeed ?? null,
    mainMotorCurrent: snapshot.mainMotorCurrent ?? null,
    mainMotorTorque: snapshot.mainMotorTorque ?? null,
    vacuumPumpSpeed01: snapshot.vacuumPumpSpeed01 ?? null,
    energyConsumption: snapshot.energyConsumption ?? null,
    rmsCurrL1: snapshot.rmsCurrL1 ?? null,
    rmsCurrL2: snapshot.rmsCurrL2 ?? null,
    rmsCurrL3: snapshot.rmsCurrL3 ?? null,
    materialInputWeight: snapshot.materialInputWeight ?? null,
    materialOutputWeight: snapshot.materialOutputWeight ?? null,
    // D1: Core process signals
    vacuumPumpSpeed02: snapshot.vacuumPumpSpeed02 ?? null,
    rmsCurrN: snapshot.rmsCurrN ?? null,
    thermoLeftLower: snapshot.thermoLeftLower ?? null,
    thermoLeftMedium: snapshot.thermoLeftMedium ?? null,
    thermoLeftUpper: snapshot.thermoLeftUpper ?? null,
    thermoRightLower: snapshot.thermoRightLower ?? null,
    thermoRightMedium: snapshot.thermoRightMedium ?? null,
    thermoRightUpper: snapshot.thermoRightUpper ?? null,
    holdingTempSetpoint: snapshot.holdingTempSetpoint ?? null,
    waterConsumption: snapshot.waterConsumption ?? null,
    // D2: Electrical grid health
    lineVoltL1L2: snapshot.lineVoltL1L2 ?? null,
    lineVoltL2L3: snapshot.lineVoltL2L3 ?? null,
    lineVoltL3L1: snapshot.lineVoltL3L1 ?? null,
    lineNeutralVoltL1: snapshot.lineNeutralVoltL1 ?? null,
    lineNeutralVoltL2: snapshot.lineNeutralVoltL2 ?? null,
    lineNeutralVoltL3: snapshot.lineNeutralVoltL3 ?? null,
    pfTotal: snapshot.pfTotal ?? null,
    // D3: High-temp zones
    thermoLeftHighLower: snapshot.thermoLeftHighLower ?? null,
    thermoLeftHighMedium: snapshot.thermoLeftHighMedium ?? null,
    thermoLeftHighUpper: snapshot.thermoLeftHighUpper ?? null,
    thermoRightHighLower: snapshot.thermoRightHighLower ?? null,
  };
}

class MachineAnomalyService {
  private detector = new OnlineAnomalyDetector();
  private startedAt: Date | null = null;
  private observationCount = 0;
  private latest: ILiveAnomalyState | null = null;
  private handler: ((snapshot: IMachineSnapshot, timestamp: Date) => void) | null = null;
  private lastPersistedAtByMode = new Map<string, number>();

  start(log: ILogger): void {
    if (this.handler) return;

    this.startedAt = new Date();
    this.handler = (snapshot: IMachineSnapshot, timestamp: Date) => {
      try {
        this.observeSnapshot(snapshot, timestamp, log);
      } catch (err) {
        log.error(
          { name: 'MachineAnomaly', err: (err as Error).message },
          'Machine anomaly observation failed',
        );
      }
    };

    dataHub.onMachineData(this.handler);
    log.info(
      {
        name: 'MachineAnomaly',
        continuousLearning: true,
        persistsAcrossRestart: true,
      },
      'Machine anomaly tracker started',
    );

    // WR-05 fix (2026-04-20): wrap shadow lifecycle symmetrically with the
    // observe() precedent. The prior "they will not throw" comment was a
    // time bomb — the first maintainer to add I/O (health probe, warm-up
    // read, TimescaleDB sanity check) to shadow start() would silently
    // couple the two services' liveness. D-18 says shadow failures must
    // never crash primary; apply that to lifecycle too.
    try {
      machineShadowAnomalyService.start(log); // ← shadow cascade (D-16, ISSUE-06: LAST line after all primary setup)
    } catch (err) {
      log.error(
        { name: 'MachineAnomalyShadow', err: (err as Error).message },
        'Shadow start failed (primary path unaffected)',
      );
    }
  }

  stop(): void {
    if (!this.handler) return;
    dataHub.off(DATA_EVENTS.MACHINE_DATA, this.handler);
    this.handler = null;
    // WR-05: symmetric try/catch on stop() too — stop() returns void today
    // but a future edit that adds I/O (flush, close, drain) could throw.
    try {
      machineShadowAnomalyService.stop(); // ← shadow cascade (LAST line; shadow stops cleanly last per ISSUE-06)
    } catch {
      // No logger available in stop(); swallow defensively. Shadow's own
      // internal failures already log at their source (observe/save/load).
    }
  }

  getLatest(): ILiveAnomalyState | null {
    return this.latest;
  }

  getTrackingStatus(): IAnomalyTrackingStatus {
    return {
      active: this.handler !== null,
      continuousLearning: true,
      persistsAcrossRestart: true,
      startedAt: this.startedAt?.toISOString() ?? null,
      observationCount: this.observationCount,
      lastObservedAt: this.latest?.observedAt ?? null,
      detectorMetrics: this.detector.getMetrics(),
    };
  }

  /** Serialize detector state for persistence across restarts (Phase 4.1). */
  serializeDetector(): ISerializedDetector {
    return this.detector.toJSON();
  }

  /** Restore detector state from a previously serialized snapshot. */
  restoreDetector(data: ISerializedDetector): void {
    this.detector = OnlineAnomalyDetector.fromJSON(data);
  }

  /** Expose detector metrics for monitoring (Phase 4.2). */
  getDetectorMetrics(): IDetectorMetrics {
    return this.detector.getMetrics();
  }

  /** C7: Get current detector config (thresholds etc). */
  getDetectorConfig(): IDetectorConfig {
    return { ...this.detector.getConfig() };
  }

  /** C7: Update detector config in-place (persisted on next shutdown via C6). */
  updateDetectorConfig(patch: Partial<IDetectorConfig>): void {
    this.detector.updateConfig(patch);
  }

  private get persistCooldownMs(): number {
    return PERSIST_COOLDOWN_MS;
  }

  private shouldPersistFlaggedEvent(state: ILiveAnomalyState): boolean {
    if (!state.flagged) return false;

    const observedAtMs = Date.parse(state.observedAt);
    const lastPersistedAt = this.lastPersistedAtByMode.get(state.modeKey);
    if (lastPersistedAt == null) return true;

    return observedAtMs - lastPersistedAt >= this.persistCooldownMs;
  }

  observeSnapshot(
    snapshot: IMachineSnapshot,
    timestamp: Date,
    log?: ILogger,
  ): ILiveAnomalyState {
    if (!this.startedAt) {
      this.startedAt = timestamp;
    }

    // D-16: hoist the detector input so primary AND shadow see the identical
    // IAnomalyInput object (same stream, same order — referential identity).
    const input = mapSnapshotToDetectorInput(snapshot);
    const result = this.detector.observe(input);

    // D-16 + D-18: shadow observes the same input. Try/catch isolates shadow
    // failures — shadow throws NEVER propagate to primary. The shadow service
    // also wraps its own observe() internally, so this is defense-in-depth.
    // WR-02 fix: pass primary's snapshot timestamp so shadow's observedAt
    // matches primary's — otherwise the /shadow/diff window comparisons
    // drift during any backfill/replay path.
    try {
      machineShadowAnomalyService.observe(input, timestamp, log);
    } catch (err) {
      if (log) {
        log.error(
          { name: 'MachineAnomalyShadow', err: (err as Error).message },
          'Shadow observe failed at orchestration layer (primary path unaffected)',
        );
      }
    }

    this.observationCount += 1;
    this.latest = {
      ...result,
      observedAt: timestamp.toISOString(),
    };

    if (result.flagged && log) {
      log.info(
        {
          name: 'MachineAnomaly',
          observedAt: this.latest.observedAt,
          modeKey: result.modeKey,
          score: result.score,
          contributors: result.topContributors,
        },
        'Machine anomaly detected',
      );
    }

    if (this.shouldPersistFlaggedEvent(this.latest)) {
      this.lastPersistedAtByMode.set(
        this.latest.modeKey,
        Date.parse(this.latest.observedAt),
      );
      void MachineAnomalyEventService.recordEvent(this.latest).catch((err: unknown) => {
        if (log) {
          log.error(
            { name: 'MachineAnomaly', err: (err as Error).message },
            'Failed to persist machine anomaly event',
          );
        }
      });
    }

    return this.latest;
  }

  async saveState(log?: ILogger): Promise<void> {
    try {
      const data = this.serializeDetector();
      await writeFile(STATE_FILE, JSON.stringify(data), 'utf-8');
      if (log) {
        log.info(
          { name: 'MachineAnomaly', file: STATE_FILE, observations: data.totalObservations },
          'Detector state saved to disk',
        );
      }
      // ← shadow cascade (ISSUE-06: AFTER primary writeFile + success log;
      //   shadow's own method handles its own errors + SHADOW_ENABLED=false per Plan 41-04).
      //   Shadow saveState requires a non-optional logger — skip when primary has no logger.
      //   WR-05 fix: distinct try/catch + shadow log name so an operator debugging a
      //   shadow-disk-full error sees "Shadow saveState failed" instead of the
      //   primary-tagged "Failed to save detector state" and chases the wrong file.
      if (log) {
        try {
          await machineShadowAnomalyService.saveState(log);
        } catch (err) {
          log.error(
            { name: 'MachineAnomalyShadow', err: (err as Error).message },
            'Shadow saveState failed (primary write succeeded)',
          );
        }
      }
    } catch (err) {
      if (log) {
        log.error(
          { name: 'MachineAnomaly', err: (err as Error).message },
          'Failed to save detector state',
        );
      }
    }
  }

  async loadState(log?: ILogger): Promise<boolean> {
    try {
      const raw = await readFile(STATE_FILE, 'utf-8');
      const data = JSON.parse(raw) as ISerializedDetector;
      this.restoreDetector(data);
      if (log) {
        log.info(
          { name: 'MachineAnomaly', file: STATE_FILE, observations: data.totalObservations },
          'Detector state restored from disk',
        );
      }
      // ← shadow cascade (ISSUE-06: AFTER primary restoreDetector; shadow loads its OWN
      //   state independently per D-13 — do NOT seed shadow from primary).
      //   Shadow loadState requires a non-optional logger — skip when primary has no logger.
      //   WR-05 fix: distinct try/catch + shadow log name so an operator debugging
      //   a shadow-load failure (corrupted anomaly-shadow-state.json) sees
      //   "Shadow loadState failed" instead of silent fall-through.
      if (log) {
        try {
          await machineShadowAnomalyService.loadState(log);
        } catch (err) {
          log.error(
            { name: 'MachineAnomalyShadow', err: (err as Error).message },
            'Shadow loadState failed (primary restore succeeded)',
          );
        }
      }
      return true;
    } catch {
      // File not found or corrupt — start fresh
      return false;
    }
  }

  resetForTest(): void {
    this.stop();
    this.detector = new OnlineAnomalyDetector();
    this.startedAt = null;
    this.observationCount = 0;
    this.latest = null;
    this.lastPersistedAtByMode.clear();
  }
}

export const machineAnomalyService = new MachineAnomalyService();
