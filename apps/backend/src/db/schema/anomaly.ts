import { pgTable, bigserial, text, real, boolean, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const machineAnomalyEvents = pgTable('machine_anomaly_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  modeKey: text('mode_key').notNull(),
  score: real('score').notNull(),
  flagged: boolean('flagged').notNull(),
  warm: boolean('warm').notNull(),
  sampleCount: integer('sample_count').notNull(),
  topContributors: jsonb('top_contributors').notNull().default('[]'),
  // C1: Event lifecycle columns
  status: text('status').notNull().default('OPEN'),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note'),
  resolutionCategory: text('resolution_category'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('machine_anomaly_events_observed_at_idx').on(table.observedAt),
  index('machine_anomaly_events_flagged_idx').on(table.flagged, table.observedAt),
  index('machine_anomaly_events_status_idx').on(table.status, table.observedAt),
]);
