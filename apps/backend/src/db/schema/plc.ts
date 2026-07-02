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
  targetHost: varchar('target_host', { length: 255 }),
  // Byte order used to decode/encode every multi-byte PLC field. Deterministic
  // by protocol version (V2 = Big-Endian, V3 = Little-Endian). Default 'le' —
  // the real ABB AC500 in the field is Little-Endian (V3).
  endian: varchar('endian', { length: 2 }).$type<'be' | 'le'>().notNull().default('le'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
