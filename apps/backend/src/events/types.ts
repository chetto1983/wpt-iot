import type { IMachineSnapshot, IAlarmWords, IRfidUser, IJobData, ICycleClosedEvent } from '@wpt/types';

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
} as const;

/** Payload types for each event */
export interface IDataHubEventMap {
  'machine:data': [snapshot: IMachineSnapshot, timestamp: Date];
  'alarm:raw': [words: IAlarmWords, timestamp: Date];
  'alarm:change': [transitions: IAlarmTransition[]];
  'user:data': [users: IRfidUser[]];
  'job:data': [job: IJobData];
  'cycle:closed': [event: ICycleClosedEvent];
}
