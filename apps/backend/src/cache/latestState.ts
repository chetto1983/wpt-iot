import type { IMachineSnapshot } from '@wpt/types';
import type { IAlarmTransition } from '../events/types.js';

/**
 * In-memory cache for the latest machine snapshot and alarm state.
 * Per D-09: singleton holding the most recent data for fast access.
 *
 * Also contains the alarm XOR diff algorithm (D-01) that detects
 * state transitions by comparing each new alarm packet against
 * the previous state.
 */
class LatestState {
  private machineSnapshot: IMachineSnapshot | null = null;
  private machineTimestamp: Date | null = null;
  private alarmWords: number[] | null = null;
  private alarmTimestamp: Date | null = null;

  setMachineSnapshot(snapshot: IMachineSnapshot, timestamp: Date): void {
    this.machineSnapshot = snapshot;
    this.machineTimestamp = timestamp;
  }

  getMachineSnapshot(): IMachineSnapshot | null {
    return this.machineSnapshot;
  }

  getLastMachineTimestamp(): Date | null {
    return this.machineTimestamp;
  }

  setAlarmWords(words: number[], timestamp: Date): void {
    this.alarmWords = [...words];
    this.alarmTimestamp = timestamp;
  }

  getAlarmWords(): number[] | null {
    return this.alarmWords ? [...this.alarmWords] : null;
  }

  getLastAlarmTimestamp(): Date | null {
    return this.alarmTimestamp;
  }

  /**
   * Detect alarm state transitions using XOR diff (per D-01).
   * Returns empty array on first call (D-03: first packet = baseline).
   *
   * Algorithm:
   * 1. If no previous state exists, store current as baseline, return []
   * 2. XOR each word pair (prev ^ curr) to find changed bits
   * 3. For each changed bit, determine if it was activated or cleared
   * 4. Update stored state to current
   */
  detectAlarmTransitions(currentWords: number[]): IAlarmTransition[] {
    const now = new Date();

    if (this.alarmWords === null) {
      // D-03: First packet sets baseline, no events generated
      this.alarmWords = [...currentWords];
      this.alarmTimestamp = now;
      return [];
    }

    const transitions: IAlarmTransition[] = [];

    for (let wordIdx = 0; wordIdx < 40; wordIdx++) {
      const prev = this.alarmWords[wordIdx] ?? 0;
      const curr = currentWords[wordIdx] ?? 0;
      const diff = prev ^ curr;

      if (diff === 0) continue;

      for (let bitIdx = 0; bitIdx < 16; bitIdx++) {
        if (diff & (1 << bitIdx)) {
          const active = Boolean(curr & (1 << bitIdx));
          transitions.push({
            alarmIndex: wordIdx * 16 + bitIdx,
            wordIndex: wordIdx,
            bitIndex: bitIdx,
            active,
            timestamp: now,
          });
        }
      }
    }

    this.alarmWords = [...currentWords];
    this.alarmTimestamp = now;
    return transitions;
  }

  /**
   * Seed alarm state from database on startup (per D-01).
   * Reconstructs the alarm word array from active alarm indices.
   * Call BEFORE starting the alarm listener to prevent false activations on restart.
   */
  seedAlarmState(activeAlarmIndices: number[]): void {
    const words = new Array<number>(40).fill(0);
    for (const alarmIndex of activeAlarmIndices) {
      const wordIdx = Math.floor(alarmIndex / 16);
      const bitIdx = alarmIndex % 16;
      if (wordIdx >= 0 && wordIdx < 40) {
        words[wordIdx] = (words[wordIdx] ?? 0) | (1 << bitIdx);
      }
    }
    this.alarmWords = words;
    this.alarmTimestamp = new Date();
  }

  /** Reset all state (for testing) */
  reset(): void {
    this.machineSnapshot = null;
    this.machineTimestamp = null;
    this.alarmWords = null;
    this.alarmTimestamp = null;
  }
}

/** Singleton in-memory cache for latest machine snapshot and alarm state */
export const latestState = new LatestState();
