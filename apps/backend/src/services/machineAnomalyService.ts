import type { IMachineSnapshot } from '@wpt/types';
import { dataHub } from '../events/hub.js';
import { DATA_EVENTS } from '../events/types.js';
import { MachineAnomalyEventService } from './machineAnomalyEventService.js';
import {
  OnlineAnomalyDetector,
  type IAnomalyResult,
  type IDetectorMetrics,
  type ISerializedDetector,
} from './onlineAnomalyDetector.js';

interface ILogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ILiveAnomalyState extends IAnomalyResult {
  observedAt: string;
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

export function mapSnapshotToDetectorInput(snapshot: IMachineSnapshot) {
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
  };
}

export class MachineAnomalyService {
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
        persistsAcrossRestart: false,
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
      persistsAcrossRestart: false,
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

  private get persistCooldownMs(): number {
    return 15 * 60 * 1000;
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
