import dgram from 'node:dgram';
import type { IMachineSnapshot } from '@wpt/types';
import { buildAlarmPacket, buildMachineDataPacket } from '@wpt/types/plc-wire';
import { getState, updateState } from '../state/simulatorState.js';
import { config } from '../config.js';
import { SENSOR_RANGES } from '../state/defaults.js';
import { cycleEngine } from '../state/cycleEngine.js';
import { alarmEngine } from '../state/alarmEngine.js';

export interface IBroadcastTarget {
  targetHost: string;
  dataPort: number;
  alarmPort: number;
  dataIntervalMs: number;
  alarmIntervalMs: number;
}

const DEFAULT_TARGET: IBroadcastTarget = {
  targetHost: config.TARGET_HOST,
  dataPort: config.TARGET_DATA_PORT,
  alarmPort: config.TARGET_ALARMS_PORT,
  dataIntervalMs: config.DATA_INTERVAL_MS,
  alarmIntervalMs: config.ALARM_INTERVAL_MS,
};

const NOISY_FIELDS: (keyof IMachineSnapshot)[] = [
  'garbageTemp', 'chamberPressure', 'mainMotorSpeed', 'mainMotorTorque',
  'mainMotorCurrent', 'vacuumPumpSpeed01', 'vacuumPumpSpeed02',
  'thermoLeftLower', 'thermoLeftMedium', 'thermoLeftUpper',
  'thermoRightLower', 'thermoRightMedium', 'thermoRightUpper',
  'thermoLeftHighLower', 'thermoLeftHighMedium', 'thermoLeftHighUpper',
  'thermoRightHighLower',
];

let socket: dgram.Socket | null = null;
let timers: ReturnType<typeof setInterval>[] = [];

/** +/- 5% of the range, clamped and rounded (INT fields). */
export function addNoise(value: number, range: { min: number; max: number }): number {
  const noise = (Math.random() - 0.5) * 2 * (range.max - range.min) * 0.05;
  return Math.round(Math.max(range.min, Math.min(range.max, value + noise)));
}

function applyNoise(machine: IMachineSnapshot): IMachineSnapshot {
  const copy: Record<string, unknown> = { ...machine };
  for (const field of NOISY_FIELDS) {
    const range = SENSOR_RANGES[field];
    if (range) copy[field] = addNoise(machine[field] as number, range);
  }
  return copy as unknown as IMachineSnapshot;
}

/** The PLC firmware delivers the material input weight in Spare_R_02 (S1_R_DATO_15). */
export function toWireSnapshot(machine: IMachineSnapshot): IMachineSnapshot {
  return { ...machine, spareReal02: machine.materialInputWeight };
}

function send(packet: Buffer, port: number, host: string, what: string): void {
  socket?.send(packet, port, host, (err) => {
    if (err) console.error(`[Broadcaster] ${what} send error: ${err.message}`);
  });
}

/** Push machine data (9090) and alarm words (9091) to the backend, like the PLC does. */
export function startBroadcasting(target: IBroadcastTarget = DEFAULT_TARGET): void {
  socket = dgram.createSocket('udp4');

  timers.push(setInterval(() => {
    cycleEngine.tick();
    const state = getState();
    send(buildMachineDataPacket(toWireSnapshot(applyNoise(state.machine))), target.dataPort, target.targetHost, 'Data');
    updateState({
      broadcast: { dataPacketCount: state.broadcast.dataPacketCount + 1, lastDataSentAt: new Date().toISOString() },
    });
  }, target.dataIntervalMs));

  timers.push(setInterval(() => {
    alarmEngine.tick();
    const state = getState();
    send(buildAlarmPacket(state.alarms), target.alarmPort, target.targetHost, 'Alarm');
    updateState({
      broadcast: { alarmPacketCount: state.broadcast.alarmPacketCount + 1, lastAlarmSentAt: new Date().toISOString() },
    });
  }, target.alarmIntervalMs));

  console.log(
    `[Broadcaster] Data every ${target.dataIntervalMs}ms, alarms every ${target.alarmIntervalMs}ms -> ${target.targetHost}`,
  );
}

export function stopBroadcasting(): void {
  timers.forEach(clearInterval);
  timers = [];
  socket?.close();
  socket = null;
}
