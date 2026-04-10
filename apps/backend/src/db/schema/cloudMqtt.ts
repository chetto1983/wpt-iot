import { pgTable, serial, boolean, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

/**
 * Cloud MQTT / Sparkplug B configuration.
 * Local Mosquitto is usually configured to bridge these topics to the cloud.
 */
export const cloudMqttConfig = pgTable('cloud_mqtt_config', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  
  // Sparkplug IDs
  groupId: varchar('group_id', { length: 255 }).default('WPT').notNull(),
  edgeNodeId: varchar('edge_node_id', { length: 255 }).default('iot-box-01').notNull(),
  
  // Connection to LOCAL broker (which bridges to cloud)
  brokerHost: varchar('broker_host', { length: 255 }).default('localhost').notNull(),
  brokerPort: integer('broker_port').default(1883).notNull(),
  username: varchar('username', { length: 255 }).default('cloud-uplink').notNull(),
  password: varchar('password', { length: 255 }).default('cloud_uplink_pass').notNull(),
  
  // Telemetry settings
  telemetryIntervalSeconds: integer('telemetry_interval_seconds').default(30).notNull(),
  publishMachineData: boolean('publish_machine_data').default(true).notNull(),
  publishCycleRecords: boolean('publish_cycle_records').default(true).notNull(),
  
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type CloudMqttConfigRow = typeof cloudMqttConfig.$inferSelect;
