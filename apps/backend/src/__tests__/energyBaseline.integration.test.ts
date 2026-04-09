/**
 * Phase 20 — energyBaselineService integration tests
 *
 * RED-by-design scaffold (Wave 0 / Plan 00).
 * Every `it.todo(...)` reserves a test name that Plans 01/03/04/05 will later
 * implement and turn green. Test names are VERBATIM from 20-VALIDATION.md
 * `-t` filter strings. Do not rename without re-syncing VALIDATION.md.
 *
 * Prereq: `cd wpt-iot && docker compose up -d db` before running.
 * Test DB is the same Postgres container as dev (Phase 19 convention).
 *
 * Pattern: mirrors wpt-iot/apps/backend/src/__tests__/energy/tariffPeriods.test.ts.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
// import { sql } from 'drizzle-orm';
// import { db, pool } from '../db/index.js';
// TODO Plan 01: uncomment when energyBaselineService ships
// import { EnergyBaselineService } from '../services/energyBaselineService.js';
// import { EnergyConfigService } from '../services/energyConfigService.js';

/**
 * Wall of 2099-01-01 isolates Phase 20 fixtures from any real data the dev DB
 * may hold. Matches aggregate.fixture.test.ts far-future-date convention.
 */
const BASELINE_FROM = new Date('2099-05-01T00:00:00Z');
const BASELINE_TO = new Date('2099-05-31T00:00:00Z');
const MEASUREMENT_FROM = new Date('2099-06-01T00:00:00Z');
const MEASUREMENT_TO = new Date('2099-06-30T00:00:00Z');

/**
 * Seeds N days of energy_1d buckets via raw machine_snapshots INSERT + CAGG refresh.
 * Plan 01 implements this — currently a stub so the file compiles.
 */
async function seedEnergyDayBuckets(_args: {
  from: Date;
  to: Date;
  totalKwh: number;
}): Promise<void> {
  // TODO Plan 01
}

async function seedCycleRecords(_args: {
  from: Date;
  to: Date;
  cyclesPerDay: number;
  kgPerCycle: number;
}): Promise<void> {
  // TODO Plan 01
}

describe('energyBaselineService integration', () => {
  beforeEach(async () => {
    // TODO Plan 01: wipe 2099+ fixtures + ensureSchema + ensureTable
    // await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id IN
    //   (SELECT baseline_id FROM energy_baselines WHERE period_from >= '2099-01-01'::timestamptz)`);
    // await db.execute(sql`DELETE FROM energy_baselines WHERE period_from >= '2099-01-01'::timestamptz`);
    // await db.execute(sql`DELETE FROM machine_snapshots WHERE timestamp >= '2099-01-01'::timestamptz`);
    // await db.execute(sql`DELETE FROM cycle_records WHERE started_at >= '2099-01-01'::timestamptz`);
    // await EnergyBaselineService.ensureSchema();
    // await EnergyConfigService.ensureTable();
  });

  afterAll(async () => {
    // TODO Plan 01: pool teardown
    // await pool.end().catch(() => undefined);
  });

  // --- Plan 01: schema ---
  it.todo('energy_baselines table shape matches DDL');
  it.todo('baseline_evidence FK restricts');

  // --- Plan 03: lock + evidence freeze ---
  it.todo('lockBaseline retires previous active baseline');
  it.todo('evidence frozen atomically in same TX');
  it.todo('daily_series fidelity — matches energy_1d + cycle_records rollup');
  it.todo('retireBaseline sets retired_at only');

  // --- Plan 04: routes + error mapping ---
  it.todo('POST baseline/lock happy path');
  it.todo('POST baseline/lock 422 on overlap and short window');
  it.todo('POST baseline/:id/retire returns 204');
  it.todo('GET savings default');
  it.todo('GET savings detail=1');
  it.todo('GET savings 204');
  it.todo('error code mapping');

  // --- Plan 05: startup validator + predates-data ---
  it.todo('startup validator fatal log');
  it.todo('BASELINE_PREDATES_DATA');
});
