import {
  pgTable,
  serial,
  integer,
  varchar,
  real,
  timestamp,
  jsonb,
  index,
  bigint,
  bigserial,
  text,
} from 'drizzle-orm/pg-core';

/**
 * Phase 19 energy schema — Drizzle pgTable definitions for TYPE INFERENCE ONLY.
 *
 * The CANONICAL creator of these tables is `EnergyConfigService.ensureTable()`
 * (and, in Plan 19-07, `EnergyAttributionService.ensureSchema()`) via direct SQL
 * `CREATE TABLE IF NOT EXISTS` calls at backend boot. Running `drizzle-kit push`
 * against this schema is FORBIDDEN — see:
 *
 *   - CLAUDE.md       §"NEVER RUN DESTRUCTIVE DB COMMANDS"
 *   - 19-CONTEXT.md   decision D-09 (all schema changes are idempotent direct SQL)
 *   - PROJECT.md      Key Decisions
 *   - ROADMAP.md      Scope Wall — Hard Boundaries
 *
 * The declarations below exist solely so TypeScript can infer row shapes
 * (`$inferSelect`) and so Drizzle query helpers in future read paths get typed
 * columns. They must never be handed to `drizzle-kit push` or any migration
 * generator. If a column is added here, the matching `CREATE TABLE IF NOT EXISTS`
 * or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` must be added to the service's
 * `ensureTable()` body by hand.
 */

// ────────────────────────────────────────────────────────────────────────────
// energy_config — singleton (id=1) holding customer header + cosphi override.
// ECFG-01, ECFG-05.
// ────────────────────────────────────────────────────────────────────────────
export const energyConfig = pgTable('energy_config', {
  id: serial('id').primaryKey(),
  customerName: varchar('customer_name', { length: 200 }).notNull().default(''),
  machineSerial: varchar('machine_serial', { length: 100 }).notNull().default(''),
  machineModel: varchar('machine_model', { length: 100 }).notNull().default(''),
  installSite: varchar('install_site', { length: 200 }).notNull().default(''),
  cosphi: real('cosphi').notNull().default(0.85),
  shiftStartHour: integer('shift_start_hour').notNull().default(6),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// energy_config_periods — versioned tariff/emission factor, half-open interval
// [valid_from, valid_to). The row whose interval contains the bucket timestamp
// is the period that was in force at aggregation time (ECFG-03/04 — cost and
// CO2 frozen at aggregation time, never recomputed at query time).
// ECFG-01..06.
// ────────────────────────────────────────────────────────────────────────────
export const energyConfigPeriods = pgTable(
  'energy_config_periods',
  {
    id: serial('id').primaryKey(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    // NULL = open-ended current period. At most one such row should exist at a time.
    validTo: timestamp('valid_to', { withTimezone: true }),
    emissionFactorKgPerKwh: real('emission_factor_kg_per_kwh').notNull().default(0.279),
    emissionFactorYear: integer('emission_factor_year').notNull().default(2024),
    emissionFactorSource: varchar('emission_factor_source', { length: 200 })
      .notNull()
      .default('ISPRA'),
    // 'single' | 'tou3'
    tariffMode: varchar('tariff_mode', { length: 16 }).notNull().default('single'),
    tariffSingleEurPerKwh: real('tariff_single_eur_per_kwh').notNull().default(0.25),
    tariffBandsJson: jsonb('tariff_bands_json').notNull().default({}),
    customHolidays: jsonb('custom_holidays').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('energy_config_periods_valid_from_idx').on(t.validFrom)],
);

// ────────────────────────────────────────────────────────────────────────────
// cycle_records — sparse table (NOT a hypertable) — one row per completed
// cycle window. Composite cycle identity = (resetEpoch, cycleNumber) so
// cycles from before a PLC counter rollover cannot collide with cycles from
// after. ENRG-02, ENRG-04, ENRG-08, ENRG-09.
// ────────────────────────────────────────────────────────────────────────────
export const cycleRecords = pgTable(
  'cycle_records',
  {
    id: serial('id').primaryKey(),
    resetEpoch: integer('reset_epoch').notNull().default(0),
    cycleNumber: integer('cycle_number').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    cycleType: integer('cycle_type').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    materialInputKg: real('material_input_kg'),
    materialOutputKg: real('material_output_kg'),
    energyKwh: real('energy_kwh'),
    waterL: real('water_l'),
    avgRmsCurrent: real('avg_rms_current'),
    // NULL when material weights are 0 — never Infinity (ENRG-09).
    kwhPerKg: real('kwh_per_kg'),
    // AttributionStatus: ATTRIBUTED | ABORTED | TOO_SHORT | DATA_GAP | UNKNOWN
    attributionStatus: varchar('attribution_status', { length: 16 })
      .notNull()
      .default('UNKNOWN'),
    serialNumber: varchar('serial_number', { length: 20 }),
    orderNumber: varchar('order_number', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cycle_records_started_at_idx').on(t.startedAt),
    index('cycle_records_cycle_type_idx').on(t.cycleType),
    index('cycle_records_composite_idx').on(t.resetEpoch, t.cycleNumber),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// cycle_resets — one row per observed PLC completedCycles counter rollover
// (ENRG-04). Written by startCycleTracker (Plan 19-05) whenever
// `completedCycles[t+1] < completedCycles[t]`.
// ────────────────────────────────────────────────────────────────────────────
export const cycleResets = pgTable(
  'cycle_resets',
  {
    id: serial('id').primaryKey(),
    resetEpoch: integer('reset_epoch').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    lastCompletedCyclesBefore: integer('last_completed_cycles_before').notNull(),
    newCompletedCyclesAfter: integer('new_completed_cycles_after').notNull(),
  },
  (t) => [index('cycle_resets_observed_at_idx').on(t.observedAt)],
);

export type EnergyConfigRow = typeof energyConfig.$inferSelect;
export type EnergyConfigPeriodRow = typeof energyConfigPeriods.$inferSelect;
export type CycleRecordRow = typeof cycleRecords.$inferSelect;
export type CycleResetRow = typeof cycleResets.$inferSelect;

// =============================================================================
// Phase 20 — Energy Baseline & Savings
// Type inference only. Canonical creator: EnergyBaselineService.ensureSchema().
// =============================================================================

export const energyBaselines = pgTable(
  'energy_baselines',
  {
    baselineId: bigserial('baseline_id', { mode: 'number' }).primaryKey(),
    label: text('label').notNull(),
    periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
    periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    justification: text('justification'),
    normalizationVariables: jsonb('normalization_variables').notNull().default({}),
    createdBy: text('created_by'),
  },
  (t) => [
    index('energy_baselines_active_lookup_idx').on(t.retiredAt, t.lockedAt),
    index('energy_baselines_period_from_idx').on(t.periodFrom),
  ],
);

export const baselineEvidence = pgTable(
  'baseline_evidence',
  {
    baselineId: bigint('baseline_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => energyBaselines.baselineId, { onDelete: 'restrict' }),
    totalKwh: real('total_kwh').notNull(),
    totalKg: real('total_kg').notNull(),
    totalCycles: integer('total_cycles').notNull(),
    enpi: real('enpi').notNull(),
    totalEur: real('total_eur').notNull(),
    totalKgco2: real('total_kgco2').notNull(),
    dailySeries: jsonb('daily_series').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('baseline_evidence_baseline_id_idx').on(t.baselineId)],
);

export type EnergyBaselineRow = typeof energyBaselines.$inferSelect;
export type BaselineEvidenceRow = typeof baselineEvidence.$inferSelect;
