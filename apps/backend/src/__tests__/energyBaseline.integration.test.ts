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

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { EnergyBaselineService } from '../services/energyBaselineService.js';
import { EnergyConfigService } from '../services/energyConfigService.js';

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
    await EnergyBaselineService.ensureSchema();
    await EnergyConfigService.ensureTable();
    await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id IN
      (SELECT baseline_id FROM energy_baselines WHERE period_from >= '2099-01-01'::timestamptz)`);
    await db.execute(sql`DELETE FROM energy_baselines WHERE period_from >= '2099-01-01'::timestamptz`);
    await db.execute(sql`DELETE FROM machine_snapshots WHERE timestamp >= '2099-01-01'::timestamptz`);
    await db.execute(sql`DELETE FROM cycle_records WHERE started_at >= '2099-01-01'::timestamptz`);
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  // --- Plan 01: schema ---
  it('energy_baselines table shape matches DDL', async () => {
    const result = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'energy_baselines'
      ORDER BY ordinal_position
    `);
    const cols = result.rows as Array<{ column_name: string; data_type: string; is_nullable: string }>;

    // 9 columns total
    expect(cols.length).toBe(9);

    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(byName.baseline_id?.data_type).toBe('bigint');
    expect(byName.label?.data_type).toBe('text');
    expect(byName.label?.is_nullable).toBe('NO');
    expect(byName.period_from?.data_type).toBe('timestamp with time zone');
    expect(byName.period_to?.data_type).toBe('timestamp with time zone');
    expect(byName.locked_at?.data_type).toBe('timestamp with time zone');
    expect(byName.retired_at?.data_type).toBe('timestamp with time zone');
    expect(byName.retired_at?.is_nullable).toBe('YES');
    expect(byName.justification?.data_type).toBe('text');
    expect(byName.normalization_variables?.data_type).toBe('jsonb');
    expect(byName.created_by?.data_type).toBe('text');
  });

  it('baseline_evidence FK restricts — deleting a parent with evidence throws', async () => {
    // Insert a baseline + matching evidence row
    const inserted = await db.execute(sql`
      INSERT INTO energy_baselines (label, period_from, period_to, locked_at, normalization_variables)
      VALUES ('fk-restrict-test', '2099-05-01T00:00:00Z'::timestamptz, '2099-05-31T00:00:00Z'::timestamptz, NOW(), '{}'::jsonb)
      RETURNING baseline_id
    `);
    const baselineId = Number((inserted.rows[0] as { baseline_id: number | string }).baseline_id);
    expect(baselineId).toBeGreaterThan(0);

    await db.execute(sql`
      INSERT INTO baseline_evidence (baseline_id, total_kwh, total_kg, total_cycles, enpi, total_eur, total_kgco2, daily_series)
      VALUES (${baselineId}, 100, 200, 30, 0.5, 25, 27.9, '[]'::jsonb)
    `);

    // Attempting to delete the parent MUST throw FK violation. Drizzle wraps
    // pg errors; the top-level message is "Failed query: ..." and the original
    // PG error lives on `.cause` with code '23001' (restrict_violation) or
    // '23503' (foreign_key_violation). We assert on the pg error code directly
    // — that is the load-bearing contract, not the wrapper message.
    let fkError: unknown = null;
    try {
      await db.execute(sql`DELETE FROM energy_baselines WHERE baseline_id = ${baselineId}`);
    } catch (err) {
      fkError = err;
    }
    expect(fkError).not.toBeNull();
    const cause = (fkError as { cause?: { code?: string; message?: string } })?.cause;
    expect(cause).toBeDefined();
    // 23001 = restrict_violation (RESTRICT), 23503 = foreign_key_violation (NO ACTION / CASCADE)
    expect(['23001', '23503']).toContain(cause?.code);

    // Cleanup: delete child first, then parent
    await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id = ${baselineId}`);
    await db.execute(sql`DELETE FROM energy_baselines WHERE baseline_id = ${baselineId}`);
  });

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
