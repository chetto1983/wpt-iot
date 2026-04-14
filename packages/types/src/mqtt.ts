import { z } from 'zod/v4';

/** MQTT role names matching Dynamic Security Plugin roles */
export enum MqttRole {
  READER = 'mqtt-reader',
  OPERATOR = 'mqtt-operator',
  ADMIN = 'mqtt-admin',
}

/** Build topic path from components */
export function mqttTopic(siteId: string, machineId: string, ...segments: string[]): string {
  return ['wpt', siteId, machineId, ...segments].join('/');
}

/** Topic suffix constants (appended after wpt/{site}/{machine}/) */
export const MQTT_TOPIC_SUFFIXES = {
  // Data/Telemetry (outbound, retained)
  SNAPSHOT: 'dt/snapshot',
  GAUGES: 'dt/gauges',
  RFID_USERS: 'dt/rfid/users',
  JOBS_CURRENT: 'dt/jobs/current',

  // Events (outbound)
  ALARMS_ACTIVE: 'evt/alarms/active',
  ALARMS_ACTIVATE: 'evt/alarms/activate',
  ALARMS_RESET: 'evt/alarms/reset',

  // Commands (inbound)
  CMD_JOB_REQ: 'cmd/job/req',
  CMD_JOB_RES: 'cmd/job/res',
  CMD_RFID_REQ: 'cmd/rfid/req',
  CMD_RFID_RES: 'cmd/rfid/res',
  CMD_CYCLE_REQ: 'cmd/cycle/req',
  CMD_CYCLE_RES: 'cmd/cycle/res',

  // State (retained, LWT)
  CONNECTION: 'state/connection',
} as const;

/** MQTT gateway configuration stored in database (server-side full row) */
export interface IMqttConfig {
  id: number;
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  username: string;
  password: string;
  siteId: string;
  machineId: string;
  useTls: boolean;
  caCert: string | null;
  sparkplugGroupId: string;
  sparkplugEdgeNodeId: string;
  publishCycleRecords: boolean;
  telemetryIntervalSeconds: number;
  updatedAt: Date;
}

/**
 * Redacted MQTT config returned by GET /api/mqtt/config — never includes
 * the broker password. The frontend uses `passwordSet` to decide whether to
 * show "leave blank to keep current" or "required" on the password input.
 */
export type IMqttConfigPublic = Omit<IMqttConfig, 'password'> & {
  passwordSet: boolean;
};

export const MqttCommandRequestSchema = z.object({
  requestId: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()),
});

/** Command response published by the gateway */
export interface IMqttCommandResponse {
  requestId: string;
  status: 'success' | 'error' | 'timeout' | 'rejected';
  message?: string;
  timestamp: string;
  handshakeDurationMs?: number;
}

/** MQTT user managed by Dynamic Security Plugin */
export interface IMqttUser {
  username: string;
  textName?: string;
  roles: MqttRole[];
  disabled?: boolean;
}

