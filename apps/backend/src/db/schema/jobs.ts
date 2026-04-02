import { pgTable, serial, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';

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

export const jobChanges = pgTable('job_changes', {
  id: serial('id').primaryKey(),
  previousSupervisor: varchar('previous_supervisor', { length: 20 }),
  previousOrderNumber: varchar('previous_order_number', { length: 20 }),
  previousSerialNumber: varchar('previous_serial_number', { length: 20 }),
  previousRemoteJobEnable: integer('previous_remote_job_enable'),
  previousMaintenanceRequest: integer('previous_maintenance_request'),
  previousRemoteCycleSelection: integer('previous_remote_cycle_selection'),
  previousCycleType: integer('previous_cycle_type'),
  currentSupervisor: varchar('current_supervisor', { length: 20 }),
  currentOrderNumber: varchar('current_order_number', { length: 20 }),
  currentSerialNumber: varchar('current_serial_number', { length: 20 }),
  currentRemoteJobEnable: integer('current_remote_job_enable'),
  currentMaintenanceRequest: integer('current_maintenance_request'),
  currentRemoteCycleSelection: integer('current_remote_cycle_selection'),
  currentCycleType: integer('current_cycle_type'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('job_changes_detected_at_idx').on(table.detectedAt),
]);
