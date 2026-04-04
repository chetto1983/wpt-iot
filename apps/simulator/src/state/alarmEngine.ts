import { updateState } from './simulatorState.js';

/** Maximum number of alarms active simultaneously */
const MAX_ACTIVE_ALARMS = 5;

/** Total alarm words (40 x 16-bit = 640 possible alarms) */
const TOTAL_WORDS = 40;
const BITS_PER_WORD = 16;

/**
 * Random alarm activation/clearing engine. Periodically activates and
 * clears random alarm bits so the alarm panel has realistic data.
 */
export class AlarmEngine {
  enabled = true;
  tickCounter = 0;
  activeAlarms = new Set<number>();
  private _nextActionTick = 30 + Math.floor(Math.random() * 30);

  /** Called every alarm broadcast interval (1s). Activates/clears alarms on schedule. */
  tick(): void {
    if (!this.enabled) return;

    this.tickCounter++;

    if (this.tickCounter >= this._nextActionTick) {
      this._performAction();
      this._nextActionTick = this.tickCounter + 30 + Math.floor(Math.random() * 30);
    }
  }

  /** Activate or clear an alarm */
  private _performAction(): void {
    const shouldClear = this.activeAlarms.size > 0 && Math.random() < 0.4;

    if (shouldClear) {
      // Clear a random active alarm
      const alarmArray = Array.from(this.activeAlarms);
      const index = Math.floor(Math.random() * alarmArray.length);
      this.activeAlarms.delete(alarmArray[index]!);
    } else if (this.activeAlarms.size < MAX_ACTIVE_ALARMS) {
      // Activate a random alarm
      const word = Math.floor(Math.random() * TOTAL_WORDS);
      const bit = Math.floor(Math.random() * BITS_PER_WORD);
      const globalIndex = word * BITS_PER_WORD + bit;
      this.activeAlarms.add(globalIndex);
    }

    // Build alarm words array from active alarms
    const words = new Array<number>(TOTAL_WORDS).fill(0);
    for (const globalIndex of this.activeAlarms) {
      const wordIdx = Math.floor(globalIndex / BITS_PER_WORD);
      const bitIdx = globalIndex % BITS_PER_WORD;
      words[wordIdx]! |= (1 << bitIdx);
    }

    updateState({ alarms: { words } });
  }

  /** Pause alarm engine */
  pause(): void {
    this.enabled = false;
  }

  /** Resume alarm engine */
  resume(): void {
    this.enabled = true;
  }

  /** Reset to initial state: no active alarms, enabled */
  reset(): void {
    this.tickCounter = 0;
    this.activeAlarms.clear();
    this._nextActionTick = 30 + Math.floor(Math.random() * 30);
    this.enabled = true;
    updateState({ alarms: { words: new Array<number>(TOTAL_WORDS).fill(0) } });
  }

  /** Get current engine status for the API */
  getStatus(): {
    enabled: boolean;
    activeAlarmCount: number;
    tickCounter: number;
  } {
    return {
      enabled: this.enabled,
      activeAlarmCount: this.activeAlarms.size,
      tickCounter: this.tickCounter,
    };
  }
}

/** Singleton alarm engine instance */
export const alarmEngine = new AlarmEngine();
