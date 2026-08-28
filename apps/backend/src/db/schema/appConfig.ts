import { pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

/** Global application settings managed by a SuperAdmin from the frontend. */
export const applicationConfig = pgTable('application_config', {
  id: serial('id').primaryKey(),
  timezone: varchar('timezone', { length: 100 }).notNull().default('Europe/Rome'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

