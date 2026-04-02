import { EventEmitter } from 'node:events';
import type { IMachineSnapshot, IAlarmWords } from '@wpt/types';
import type { IAlarmTransition } from './types.js';
import { DATA_EVENTS } from './types.js';

/**
 * Typed EventEmitter hub for the UDP data pipeline.
 * Decouples UDP listeners (producers) from consumers (persistence, cache, WebSocket).
 * Per D-08: Phase 6 WebSocket layer subscribes to this hub with zero refactoring.
 */
class DataHub extends EventEmitter {
  emitMachineData(snapshot: IMachineSnapshot, timestamp: Date): boolean {
    return this.emit(DATA_EVENTS.MACHINE_DATA, snapshot, timestamp);
  }

  onMachineData(handler: (snapshot: IMachineSnapshot, timestamp: Date) => void): this {
    return this.on(DATA_EVENTS.MACHINE_DATA, handler);
  }

  emitAlarmRaw(words: IAlarmWords, timestamp: Date): boolean {
    return this.emit(DATA_EVENTS.ALARM_RAW, words, timestamp);
  }

  onAlarmRaw(handler: (words: IAlarmWords, timestamp: Date) => void): this {
    return this.on(DATA_EVENTS.ALARM_RAW, handler);
  }

  emitAlarmChange(transitions: IAlarmTransition[]): boolean {
    return this.emit(DATA_EVENTS.ALARM_CHANGE, transitions);
  }

  onAlarmChange(handler: (transitions: IAlarmTransition[]) => void): this {
    return this.on(DATA_EVENTS.ALARM_CHANGE, handler);
  }
}

/** Singleton data hub -- all UDP listeners emit here, all consumers subscribe here */
export const dataHub = new DataHub();
