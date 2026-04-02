import { pgTable, serial, integer, boolean, timestamp, text, varchar, index } from 'drizzle-orm/pg-core';

export const alarmEvents = pgTable('alarm_events', {
  id: serial('id').primaryKey(),
  alarmIndex: integer('alarm_index').notNull(),
  wordIndex: integer('word_index').notNull(),
  bitIndex: integer('bit_index').notNull(),
  active: boolean('active').notNull(),
  transitionType: varchar('transition_type', { length: 20 }).notNull(), // D-02: 'ACTIVE', 'CLEAR', future 'ACK'/'SHELVE'/'SUPPRESS'
  activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }),
  descriptionIt: text('description_it').notNull().default(''),  // Empty until Phase 4 DATA-03
  descriptionEn: text('description_en').notNull().default(''),  // Empty until Phase 4 DATA-03
}, (table) => [
  index('alarm_events_activated_at_idx').on(table.activatedAt),
  index('alarm_events_alarm_index_idx').on(table.alarmIndex),
]);
