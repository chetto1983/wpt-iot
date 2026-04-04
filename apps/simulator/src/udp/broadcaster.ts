import dgram from 'node:dgram';
import { getState, updateState } from '../state/simulatorState.js';
import { buildMachineDataPacket, buildAlarmPacket, addNoise } from './packetBuilder.js';
import { config } from '../config.js';
import { SENSOR_RANGES } from '../state/defaults.js';
import { cycleEngine } from '../state/cycleEngine.js';
import { alarmEngine } from '../state/alarmEngine.js';
import type { IMachineSnapshot } from '@wpt/types';

let dataSocket: dgram.Socket | null = null;
let alarmSocket: dgram.Socket | null = null;
let dataInterval: ReturnType<typeof setInterval> | null = null;
let alarmInterval: ReturnType<typeof setInterval> | null = null;

/** Sensor fields that should have noise applied during broadcast */
const NOISY_FIELDS: (keyof IMachineSnapshot)[] = [
  'garbageTemp', 'chamberPressure', 'mainMotorSpeed', 'mainMotorTorque',
  'mainMotorCurrent', 'vacuumPumpSpeed01', 'vacuumPumpSpeed02',
  'thermoLeftLower', 'thermoLeftMedium', 'thermoLeftUpper',
  'thermoRightLower', 'thermoRightMedium', 'thermoRightUpper',
  'thermoLeftHighLower', 'thermoLeftHighMedium', 'thermoLeftHighUpper',
  'thermoRightHighLower',
];

/**
 * Apply noise to sensor fields in a machine data snapshot.
 * Returns a copy with noise applied (does not mutate the original).
 */
function applyNoise(machine: IMachineSnapshot): IMachineSnapshot {
  const copy = { ...machine };
  for (const field of NOISY_FIELDS) {
    const range = SENSOR_RANGES[field];
    if (range) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (copy as any)[field] = addNoise(copy[field] as number, range);
    }
  }
  return copy;
}

/** Start broadcasting machine data and alarm packets on UDP */
export function startBroadcasting(): void {
  dataSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  alarmSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  // Data broadcast (every DATA_INTERVAL_MS = 15000ms)
  dataInterval = setInterval(() => {
    cycleEngine.tick();
    const state = getState();
    const noisyMachine = applyNoise(state.machine);
    const packet = buildMachineDataPacket(noisyMachine);

    dataSocket!.send(packet, 0, packet.length, config.TARGET_DATA_PORT, config.TARGET_HOST, (err) => {
      if (err) {
        console.error(`[Broadcaster] Data send error: ${err.message}`);
      }
    });

    updateState({
      broadcast: {
        dataPacketCount: state.broadcast.dataPacketCount + 1,
        lastDataSentAt: new Date().toISOString(),
      },
    });
  }, config.DATA_INTERVAL_MS);

  // Alarm broadcast (every ALARM_INTERVAL_MS = 1000ms)
  alarmInterval = setInterval(() => {
    alarmEngine.tick();
    const state = getState();
    const packet = buildAlarmPacket(state.alarms);

    alarmSocket!.send(packet, 0, packet.length, config.TARGET_ALARMS_PORT, config.TARGET_HOST, (err) => {
      if (err) {
        console.error(`[Broadcaster] Alarm send error: ${err.message}`);
      }
    });

    updateState({
      broadcast: {
        alarmPacketCount: state.broadcast.alarmPacketCount + 1,
        lastAlarmSentAt: new Date().toISOString(),
      },
    });
  }, config.ALARM_INTERVAL_MS);

  console.log(`[Broadcaster] Started broadcasting data every ${config.DATA_INTERVAL_MS}ms, alarms every ${config.ALARM_INTERVAL_MS}ms`);
}

/** Stop broadcasting and close UDP sockets */
export function stopBroadcasting(): void {
  if (dataInterval) {
    clearInterval(dataInterval);
    dataInterval = null;
  }
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  if (dataSocket) {
    try { dataSocket.close(); } catch { /* socket may already be closed */ }
    dataSocket = null;
  }
  if (alarmSocket) {
    try { alarmSocket.close(); } catch { /* socket may already be closed */ }
    alarmSocket = null;
  }
  console.log(`[Broadcaster] Stopped broadcasting`);
}
