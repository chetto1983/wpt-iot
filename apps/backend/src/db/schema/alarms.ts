import { pgTable, serial, integer, boolean, timestamp, text, index } from 'drizzle-orm/pg-core';

export const alarmEvents = pgTable('alarm_events', {
  id: serial('id').primaryKey(),
  alarmIndex: integer('alarm_index').notNull(),
  wordIndex: integer('word_index').notNull(),
  bitIndex: integer('bit_index').notNull(),
  active: boolean('active').notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }),
  descriptionIt: text('description_it').notNull(),
  descriptionEn: text('description_en').notNull(),
}, (table) => [
  index('alarm_events_activated_at_idx').on(table.activatedAt),
]);
