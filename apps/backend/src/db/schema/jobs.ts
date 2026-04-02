import { pgTable, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  supervisor: varchar('supervisor', { length: 20 }),
  orderNumber: varchar('order_number', { length: 20 }),
  serialNumber: varchar('serial_number', { length: 20 }),
  remoteJobEnable: integer('remote_job_enable').notNull().default(0),
  maintenanceRequest: integer('maintenance_request').notNull().default(0),
  remoteCycleSelection: integer('remote_cycle_selection').notNull().default(0),
  cycleType: integer('cycle_type').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
