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

// ---------------------------------------------------------------------------
// Phase 41: Shadow anomaly events table (D-01, D-05)
// ---------------------------------------------------------------------------
// Mirror of machine_anomaly_events minus triage columns (status/resolved_*) —
// shadow events are never operator-triaged (SHADOW-03). Adds detectorVariant
// (D-02, MLflow/SageMaker role-label convention) and tuningNotes (D-03,
// auto-populated config diff vs primary at insert time).
//
// D-01: converted to a TimescaleDB hypertable with retention 30d, chunk 7d,
// compression 2d — all done inside setup_timescaledb_retention() §7 so Drizzle
// push + applyTimescaleSetup() are the two idempotent paths.
//
// The third index (mode_key_idx) is added for D-22 diff-query performance
// (GROUP BY (variant, mode_key) over the time window). Primary table does NOT
// have this index — its access patterns are different.
export const machineAnomalyEventsShadow = pgTable('machine_anomaly_events_shadow', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  modeKey: text('mode_key').notNull(),
  score: real('score').notNull(),
  flagged: boolean('flagged').notNull(),
  warm: boolean('warm').notNull(),
  sampleCount: integer('sample_count').notNull(),
  topContributors: jsonb('top_contributors').notNull().default('[]'),
  // D-02: detector variant label (role-not-identity, MLflow/SageMaker convention)
  detectorVariant: text('detector_variant').notNull(),
  // D-03: config diff vs primary — auto-populated at row insert time
  tuningNotes: jsonb('tuning_notes').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // D-05: NO status/resolved_* columns — shadow events are never operator-triaged (SHADOW-03)
}, (table) => [
  index('machine_anomaly_events_shadow_observed_at_idx').on(table.observedAt),
  index('machine_anomaly_events_shadow_flagged_idx').on(table.flagged, table.observedAt),
  index('machine_anomaly_events_shadow_mode_key_idx').on(table.modeKey, table.observedAt),
]);
