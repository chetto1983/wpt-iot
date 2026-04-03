import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from workspace root (wpt-iot/.env) since pnpm sets cwd to package dir
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

export interface ISimulatorConfig {
  SIM_PORT: number;
  TARGET_HOST: string;
  TARGET_DATA_PORT: number;
  TARGET_ALARMS_PORT: number;
  UDP_LISTEN_DATA: number;
  UDP_LISTEN_ALARMS: number;
  UDP_LISTEN_USERS: number;
  UDP_LISTEN_ACK: number;
  DATA_INTERVAL_MS: number;
  ALARM_INTERVAL_MS: number;
  STATE_FILE_PATH: string;
}

function envInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envStr(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config: ISimulatorConfig = {
  SIM_PORT: envInt('SIM_PORT', 3002),
  TARGET_HOST: envStr('TARGET_HOST', 'host.docker.internal'),
  TARGET_DATA_PORT: envInt('TARGET_DATA_PORT', 9090),
  TARGET_ALARMS_PORT: envInt('TARGET_ALARMS_PORT', 9091),
  UDP_LISTEN_DATA: envInt('UDP_LISTEN_DATA', 9090),
  UDP_LISTEN_ALARMS: envInt('UDP_LISTEN_ALARMS', 9091),
  UDP_LISTEN_USERS: envInt('UDP_LISTEN_USERS', 9092),
  UDP_LISTEN_ACK: envInt('UDP_LISTEN_ACK', 9093),
  DATA_INTERVAL_MS: envInt('DATA_INTERVAL_MS', 15000),
  ALARM_INTERVAL_MS: envInt('ALARM_INTERVAL_MS', 1000),
  STATE_FILE_PATH: envStr('STATE_FILE_PATH', '/app/data/simulator-state.json'),
};
