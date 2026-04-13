/** Alarm state transition detected by XOR diff */
export interface IAlarmTransition {
  alarmIndex: number;   // Global index 0-639
  wordIndex: number;    // Which of 40 words (0-39)
  bitIndex: number;     // Which bit in word (0-15)
  active: boolean;      // true=activated, false=cleared
  timestamp: Date;
}

/** Event names emitted by the data hub */
export const DATA_EVENTS = {
  MACHINE_DATA: 'machine:data',
  ALARM_RAW: 'alarm:raw',
  ALARM_CHANGE: 'alarm:change',
  USER_DATA: 'user:data',
  JOB_DATA: 'job:data',
  CYCLE_CLOSED: 'cycle:closed',
  CYCLE_START: 'cycle:start',
} as const;
