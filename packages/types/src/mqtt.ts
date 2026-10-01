/** Sparkplug B uplink configuration stored in database (server-side full row) */
export interface IMqttConfig {
  id: number;
  enabled: boolean;
  brokerHost: string;
  brokerPort: number;
  username: string;
  password: string;
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
