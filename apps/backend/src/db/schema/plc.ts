import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';

/**
 * PLC handshake target configuration — single row, id=1.
 *
 * Stores the network address of the ABB AC500 PLC (or CODESYS simulator)
 * that the backend sends handshake control messages to. Replaces the legacy
 * `SIM_HOST` environment variable so operators can change the target from
 * the frontend UI without restarting the container.
 */
export const plcConfig = pgTable('plc_config', {
  id: serial('id').primaryKey(),
  targetHost: varchar('target_host', { length: 255 }).default('localhost').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
