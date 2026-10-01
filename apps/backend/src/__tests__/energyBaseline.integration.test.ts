/**
 * Phase 20 — energyBaselineService integration tests (service layer):
 * schema DDL, lock + evidence freeze, startup validator.
 * HTTP route coverage lives in energyBaselineRoutes.integration.test.ts.
 *
 * Test names are VERBATIM from 20-VALIDATION.md `-t` filter strings.
 * Do not rename without re-syncing VALIDATION.md.
 *
 * Prereq: `cd wpt-iot && docker compose up -d db` before running.
 * Test DB is the same Postgres container as dev (Phase 19 convention).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { EnergyBaselineService, EnergyConfigService } from '../services/energy/index.js';
import {
  BASELINE_FROM,
  BASELINE_TO,
  cleanupBaselineArea,
  seedCycleRecords,
  seedEnergyDayBuckets,
  setupEnergyAggregates,
} from './energy/baselineFixtures.js';

describe('energyBaselineService integration', () => {
  beforeAll(async () => {
    await setupEnergyAggregates();
  });

  beforeEach(async () => {
    await EnergyBaselineService.ensureSchema();
    await EnergyConfigService.ensureTable();
    await cleanupBaselineArea();
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
  it('lockBaseline retires previous active baseline', async () => {
    // Seed enough data for a valid 30-day window lock
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const first = await EnergyBaselineService.lockBaseline({
      label: 'first baseline',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      justification: 'test',
      normalizationVariables: { temp: 20 },
    });
    expect(first.baseline.retiredAt).toBeNull();

    // Lock a second baseline — should retire the first inside the same TX
    const second = await EnergyBaselineService.lockBaseline({
      label: 'second baseline',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      justification: 'test',
      normalizationVariables: { temp: 22 },
    });
    expect(second.baseline.baselineId).not.toBe(first.baseline.baselineId);

    // First baseline should now be retired
    const refetched = await EnergyBaselineService.getBaselineById(first.baseline.baselineId);
    expect(refetched).not.toBeNull();
    expect(refetched?.retiredAt).not.toBeNull();

    // Only the second baseline is active
    const active = await EnergyBaselineService.getActiveBaseline();
    expect(active?.baselineId).toBe(second.baseline.baselineId);
  });

  it('evidence frozen atomically in same TX', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const result = await EnergyBaselineService.lockBaseline({
      label: 'atomic-test',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      normalizationVariables: {},
    });

    // Exactly one evidence row exists for this baseline_id
    const evidenceRows = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM baseline_evidence
      WHERE baseline_id = ${result.baseline.baselineId}
    `);
    expect(Number((evidenceRows.rows[0] as { n: number }).n)).toBe(1);
    expect(result.evidence.totalKwh).toBeGreaterThan(0);
    expect(result.evidence.totalKg).toBeGreaterThan(0);
    expect(result.evidence.enpi).toBeGreaterThan(0);
  });

  it('daily_series fidelity — matches energy_1d + cycle_records rollup', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    const result = await EnergyBaselineService.lockBaseline({
      label: 'daily-series-test',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      normalizationVariables: { temp: 20 },
    });
    // 30-day window expected to have ~30 daily entries (give or take CAGG bucket alignment)
    expect(result.evidence.dailySeries.length).toBeGreaterThanOrEqual(28);
    expect(result.evidence.dailySeries.length).toBeLessThanOrEqual(32);

    // Every entry is a valid YYYY-MM-DD date string with non-negative scalars
    for (const pt of result.evidence.dailySeries) {
      expect(pt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(pt.kwh).toBeGreaterThanOrEqual(0);
      expect(pt.kg).toBeGreaterThanOrEqual(0);
      expect(pt.cyclesCount).toBeGreaterThanOrEqual(0);
    }
    // Ascending order by date string
    const dates = result.evidence.dailySeries.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);

    // totalKg in evidence equals sum of dailySeries kg (within float precision)
    const sumKg = result.evidence.dailySeries.reduce((acc, p) => acc + p.kg, 0);
    expect(result.evidence.totalKg).toBeCloseTo(sumKg, 3);
  });

  it('retireBaseline sets retired_at only', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const locked = await EnergyBaselineService.lockBaseline({
      label: 'retire-test',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      normalizationVariables: {},
    });
    const before = await EnergyBaselineService.getBaselineById(locked.baseline.baselineId);
    expect(before).not.toBeNull();
    expect(before?.retiredAt).toBeNull();

    await EnergyBaselineService.retireBaseline(locked.baseline.baselineId);

    const after = await EnergyBaselineService.getBaselineById(locked.baseline.baselineId);
    expect(after).not.toBeNull();
    expect(after?.retiredAt).not.toBeNull();
    // Other columns unchanged
    expect(after?.label).toBe(before?.label);
    expect(after?.periodFrom.toISOString()).toBe(before?.periodFrom.toISOString());
    expect(after?.periodTo.toISOString()).toBe(before?.periodTo.toISOString());
    expect(after?.lockedAt.toISOString()).toBe(before?.lockedAt.toISOString());
  });

  it('freezeBaselineEvidence: day with cycles but no energy_1d row still contributes to totalKg', async () => {
    // Seed full window of energy_1d + cycle_records
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    // Pick day 5 of the window. Delete its energy_1d bucket to simulate
    // CA-refresh lag / PLC outage on that day. The cycle records on the
    // same day stay — that is the WARNING 1 asymmetry case.
    const orphanDay = new Date(BASELINE_FROM.getTime() + 5 * 86_400_000);
    const orphanDayEnd = new Date(orphanDay.getTime() + 86_400_000);
    await db.execute(sql`
      DELETE FROM machine_snapshots
      WHERE timestamp >= ${orphanDay.toISOString()}::timestamptz
        AND timestamp <  ${orphanDayEnd.toISOString()}::timestamptz
    `);
    // Refresh CAGG over the orphan day so the deletion propagates
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_5min',
        ${new Date(orphanDay.getTime() - 4 * 3600_000).toISOString()}::timestamptz,
        ${new Date(orphanDayEnd.getTime() + 4 * 3600_000).toISOString()}::timestamptz)
    `);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_1h',
        ${new Date(orphanDay.getTime() - 4 * 3600_000).toISOString()}::timestamptz,
        ${new Date(orphanDayEnd.getTime() + 4 * 3600_000).toISOString()}::timestamptz)
    `);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_1d',
        ${new Date(orphanDay.getTime() - 4 * 3600_000).toISOString()}::timestamptz,
        ${new Date(orphanDayEnd.getTime() + 4 * 3600_000).toISOString()}::timestamptz)
    `);

    const result = await EnergyBaselineService.lockBaseline({
      label: 'cycles-only-day-test',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      normalizationVariables: {},
    });

    // The orphaned day MUST appear in dailySeries with kwh=0 but nonzero kg
    // (Europe/Rome local day key)
    const orphanKey = orphanDay.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const orphanEntry = result.evidence.dailySeries.find((p) => p.date === orphanKey);
    expect(orphanEntry, `orphan day ${orphanKey} must appear in dailySeries`).toBeDefined();
    expect(orphanEntry!.kwh).toBe(0);
    expect(orphanEntry!.eur).toBe(0);
    expect(orphanEntry!.kgco2).toBe(0);
    // The seeded 2 cycles/day × 20 kg = 40 kg should still be present
    expect(orphanEntry!.kg).toBeGreaterThan(0);
    expect(orphanEntry!.cyclesCount).toBeGreaterThanOrEqual(1);

    // Evidence scalar totalKg MUST equal the sum of dailySeries kg (WARNING 1 fix)
    const sumFromSeries = result.evidence.dailySeries.reduce((acc, p) => acc + p.kg, 0);
    expect(result.evidence.totalKg).toBeCloseTo(sumFromSeries, 3);
  });

  // --- Plan 05: startup validator + predates-data ---
  it('startup validator fatal log', async () => {
    // First seed fresh data so energy_1d has a known MIN bucket. The CAGG may
    // have stale buckets from prior tests (older rolling windows, 2099-*) that
    // we cannot DELETE directly — we must pick a baseline period_from EARLIER
    // than the CURRENT MIN(bucket_1d) at runtime. Seeding first is just a
    // safety: guarantees energy_1d is non-empty so the first-boot skip path
    // does not fire.
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });

    // Query the current MIN(bucket_1d) and pin the baseline's period_from ONE
    // DAY EARLIER. That makes the "predates" check deterministic regardless
    // of what stale CAGG chunks survive between test runs.
    const minRes = await db.execute(sql`
      SELECT MIN(bucket_1d) AS oldest FROM energy_1d
    `);
    const oldestRaw = (minRes.rows[0] as { oldest: string | Date | null } | undefined)?.oldest;
    expect(oldestRaw).not.toBeNull();
    const oldestBucket = oldestRaw instanceof Date ? oldestRaw : new Date(oldestRaw as string);
    const BASELINE_STARTS_EARLY = new Date(oldestBucket.getTime() - 86_400_000);
    const BASELINE_ENDS_EARLY = new Date(BASELINE_STARTS_EARLY.getTime() + 20 * 86_400_000);

    const insertRes = await db.execute(sql`
      INSERT INTO energy_baselines (label, period_from, period_to, locked_at, normalization_variables)
      VALUES ('predate-test', ${BASELINE_STARTS_EARLY.toISOString()}::timestamptz, ${BASELINE_ENDS_EARLY.toISOString()}::timestamptz, NOW(), '{}'::jsonb)
      RETURNING baseline_id
    `);
    const baselineId = Number(
      (insertRes.rows[0] as { baseline_id: number | string }).baseline_id,
    );
    // Matching evidence row (FK ON DELETE RESTRICT — cleanup needs it too)
    await db.execute(sql`
      INSERT INTO baseline_evidence (baseline_id, total_kwh, total_kg, total_cycles, enpi, total_eur, total_kgco2, daily_series)
      VALUES (${baselineId}, 1, 1, 1, 1, 0.25, 0.279, '[]'::jsonb)
    `);

    try {
      const baseline = await EnergyBaselineService.getBaselineById(baselineId);
      expect(baseline).not.toBeNull();

      // Capturing mock logger (RESEARCH BLOCKER-03 Option 2)
      const captured: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
      const testLog = {
        info: (obj: Record<string, unknown>, msg: string) =>
          captured.push({ level: 'info', obj, msg }),
        warn: (obj: Record<string, unknown>, msg: string) =>
          captured.push({ level: 'warn', obj, msg }),
        error: (obj: Record<string, unknown>, msg: string) =>
          captured.push({ level: 'error', obj, msg }),
        fatal: (obj: Record<string, unknown>, msg: string) =>
          captured.push({ level: 'fatal', obj, msg }),
      };

      // Expect a throw AND a fatal log with the RESEARCH.md payload shape
      await expect(
        EnergyBaselineService.validateOldestDataAvailability(baseline!, testLog),
      ).rejects.toThrow(/predates/i);

      const fatals = captured.filter((c) => c.level === 'fatal');
      expect(fatals.length).toBe(1);
      expect(fatals[0]?.msg).toBe('baseline_predates_available_data');
      expect(fatals[0]?.obj.baselineId).toBe(baselineId);
      expect(fatals[0]?.obj.oldestBucket).toBeDefined();
      expect(fatals[0]?.obj.baselinePeriodFrom).toBe(BASELINE_STARTS_EARLY.toISOString());
    } finally {
      // Explicit cleanup — period_from may be outside the beforeEach cleanup
      // walls (depends on the stale CAGG MIN at runtime). Order matters:
      // evidence first (FK ON DELETE RESTRICT), then baseline.
      await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id = ${baselineId}`);
      await db.execute(sql`DELETE FROM energy_baselines WHERE baseline_id = ${baselineId}`);
    }
  });
});
