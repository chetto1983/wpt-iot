import { pgTable, serial, boolean, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

/** MQTT gateway configuration — single row, id=1 */
export const mqttConfig = pgTable('mqtt_config', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  brokerHost: varchar('broker_host', { length: 255 }).default('localhost').notNull(),
  brokerPort: integer('broker_port').default(1883).notNull(),
  siteId: varchar('site_id', { length: 100 }).default('site-01').notNull(),
  machineId: varchar('machine_id', { length: 100 }).default('wpt40-001').notNull(),
  publishMachine: boolean('publish_machine').default(true).notNull(),
  publishAlarms: boolean('publish_alarms').default(true).notNull(),
  publishRfid: boolean('publish_rfid').default(false).notNull(),
  publishJobs: boolean('publish_jobs').default(false).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
