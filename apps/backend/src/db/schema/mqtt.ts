import { pgTable, serial, boolean, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

/** MQTT gateway configuration — single row, id=1 */
export const mqttConfig = pgTable('mqtt_config', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  brokerHost: varchar('broker_host', { length: 255 }).default('localhost').notNull(),
  brokerPort: integer('broker_port').default(1883).notNull(),
  username: varchar('username', { length: 255 }).default('wpt-backend').notNull(),
  // Stored encrypted at rest (AES-256-GCM via secretCipher.ts). Plaintext
  // values — including the legacy 'wpt_mqtt_dev_password' default that older
  // deployments received — are auto-encrypted on startup by
  // MqttConfigService.ensureTable(). Empty string means "no password set"
  // and the form blocks enabling the gateway until one is provided.
  // VARCHAR widened to 512 to fit the v1: envelope (iv + tag + ciphertext).
  password: varchar('password', { length: 512 }).default('').notNull(),
  siteId: varchar('site_id', { length: 100 }).default('site-01').notNull(),
  machineId: varchar('machine_id', { length: 100 }).default('wpt40-001').notNull(),
  useTls: boolean('use_tls').default(false).notNull(),
  caCert: varchar('ca_cert', { length: 10000 }),
  sparkplugGroupId: varchar('sparkplug_group_id', { length: 255 }).default('WPT').notNull(),
  sparkplugEdgeNodeId: varchar('sparkplug_edge_node_id', { length: 255 }).default('iot-box-01').notNull(),
  publishCycleRecords: boolean('publish_cycle_records').default(false).notNull(),
  telemetryIntervalSeconds: integer('telemetry_interval_seconds').default(30).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
