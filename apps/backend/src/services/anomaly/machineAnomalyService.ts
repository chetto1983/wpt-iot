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
  }

  stop(): void {
    if (!this.handler) return;
    dataHub.off(DATA_EVENTS.MACHINE_DATA, this.handler);
    this.handler = null;
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

    const result = this.detector.observe(mapSnapshotToDetectorInput(snapshot));
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
