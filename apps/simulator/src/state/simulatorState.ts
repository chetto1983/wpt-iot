import { HandshakeState } from '@wpt/types';
import type { IMachineSnapshot, IAlarmWords, IRfidUser, IJobData } from '@wpt/types';
import { createDefaultMachineData, createDefaultUsers, createDefaultJob } from './defaults.js';

export interface ISimulatorState {
  machine: IMachineSnapshot;
  alarms: IAlarmWords;
  users: IRfidUser[];
  job: IJobData;
  handshake: {
    ackDelayMs: number;
    faultDropAck: boolean;
    faultWrongState: boolean;
    port9090State: HandshakeState;
    port9092State: HandshakeState;
  };
  broadcast: {
    dataPacketCount: number;
    alarmPacketCount: number;
    lastDataSentAt: string | null;
    lastAlarmSentAt: string | null;
  };
}

/** Deep partial type for nested state updates */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function createDefaultState(): ISimulatorState {
  return {
    machine: createDefaultMachineData(),
    alarms: { words: new Array<number>(40).fill(0) },
    users: createDefaultUsers(),
    job: createDefaultJob(),
    handshake: {
      ackDelayMs: 0,
      faultDropAck: false,
      faultWrongState: false,
      port9090State: HandshakeState.IDLE,
      port9092State: HandshakeState.IDLE,
    },
    broadcast: {
      dataPacketCount: 0,
      alarmPacketCount: 0,
      lastDataSentAt: null,
      lastAlarmSentAt: null,
    },
  };
}

/** Singleton state instance */
let state: ISimulatorState = createDefaultState();

/** Deep merge source into target */
function deepMerge<T extends Record<string, unknown>>(target: T, source: DeepPartial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as DeepPartial<Record<string, unknown>>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/** Get the current simulator state */
export function getState(): ISimulatorState {
  return state;
}

/** Deep merge a partial update into the current state */
export function updateState(partial: DeepPartial<ISimulatorState>): void {
  state = deepMerge(state, partial);
}

/** Reset state to defaults */
export function resetState(): void {
  state = createDefaultState();
}
