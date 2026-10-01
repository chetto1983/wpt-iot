import type { PlcEndian } from '@wpt/types/plc-wire';

/**
 * Environment-only config. Ports default to the real PLC's, so from the
 * backend's side the simulator is a drop-in PLC: own IP, standard ports.
 */
export interface ISimulatorConfig {
  SIM_PORT: number;
  /** The backend's address; in compose the wpt-sim gateway. */
  TARGET_HOST: string;
  TARGET_DATA_PORT: number;
  TARGET_ALARMS_PORT: number;
  TARGET_USERS_PORT: number;
  TARGET_ACK_PORT: number;
  UDP_LISTEN_DATA: number;
  UDP_LISTEN_USERS: number;
  UDP_LISTEN_ACK: number;
  DATA_INTERVAL_MS: number;
  ALARM_INTERVAL_MS: number;
  STATE_FILE_PATH: string;
  /** Must match the backend's plc_config.endian (default 'le', like the real V3 PLC). */
  PLC_ENDIAN: PlcEndian;
}

function envInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${key} must be an integer, got "${raw}"`);
  return parsed;
}

function envEndian(): PlcEndian {
  const raw = process.env.PLC_ENDIAN ?? 'le';
  if (raw !== 'le' && raw !== 'be') throw new Error(`PLC_ENDIAN must be 'le' or 'be', got "${raw}"`);
  return raw;
}

export const config: ISimulatorConfig = {
  SIM_PORT: envInt('SIM_PORT', 3002),
  TARGET_HOST: process.env.TARGET_HOST ?? '127.0.0.1',
  TARGET_DATA_PORT: envInt('TARGET_DATA_PORT', 9090),
  TARGET_ALARMS_PORT: envInt('TARGET_ALARMS_PORT', 9091),
  TARGET_USERS_PORT: envInt('TARGET_USERS_PORT', 9092),
  TARGET_ACK_PORT: envInt('TARGET_ACK_PORT', 9093),
  UDP_LISTEN_DATA: envInt('UDP_LISTEN_DATA', 9090),
  UDP_LISTEN_USERS: envInt('UDP_LISTEN_USERS', 9092),
  UDP_LISTEN_ACK: envInt('UDP_LISTEN_ACK', 9093),
  DATA_INTERVAL_MS: envInt('DATA_INTERVAL_MS', 15000),
  ALARM_INTERVAL_MS: envInt('ALARM_INTERVAL_MS', 1000),
  STATE_FILE_PATH: process.env.STATE_FILE_PATH ?? '/app/data/simulator-state.json',
  PLC_ENDIAN: envEndian(),
};
