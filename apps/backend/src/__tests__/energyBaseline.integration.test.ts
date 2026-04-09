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
 * Phase 20 fixture date wall.
 *
 * Plan 00 originally pinned 2099+ for test isolation (matching
 * aggregate.fixture.test.ts), but `lockBaseline` enforces a hard
 * "period_from must NOT be in the future" guard (BaselineTooShortError
 * reason='period_from_future', from RESEARCH.md step 11). 2099 is in the
 * future, so any test that calls lockBaseline through that guard fails.
 *
 * 1999-* would isolate but predates the seed `energy_config_periods` row
 * (valid_from = DEFAULT_TARIFF_VALID_FROM_ISO = 2024-01-01), so per-day
 * tariff lookups in `freezeBaselineEvidence` would throw "no period covers
 * timestamp" — that error is the correct production behavior, not a bug.
 *
 * 2024-05-* is the sweet spot:
 *  - In the past (Date.now() = 2026-04), so the future-date guard passes
 *  - After 2024-01-01, so the open-ended seed period covers it
 *  - Far enough from the current dev-session window (2026-04) that
 *    accidental simulator collisions are extremely unlikely
 *  - Cleanup wall scoped to 2024-04-01..2024-07-01 plus a backwards-compat
 *    2099+ rule for the Plan 01 raw-SQL FK / schema tests that still use
 *    literal 2099 strings.
 */
const BASELINE_FROM = new Date('2024-05-01T00:00:00Z');
const BASELINE_TO = new Date('2024-05-31T00:00:00Z');
const MEASUREMENT_FROM = new Date('2024-06-01T00:00:00Z');
const MEASUREMENT_TO = new Date('2024-06-30T00:00:00Z');

/**
 * Seeds N days of machine_snapshots + refreshes the CAGG chain so energy_1d
 * has data in the [from, to) window. Mirrors aggregate.fixture.test.ts:
 * the energy_5min CAGG computes `last(energy_consumption) - first(energy_consumption)`
 * per bucket; chained sum to energy_1h then energy_1d gives the daily kwh delta.
 *
 * Two snapshots per day at 00:30 and 12:30 UTC, energy_consumption rising
 * by `totalKwh / days` between them and carrying forward across days. The
 * +0.5h offsets keep both samples inside the SAME 5-min CAGG bucket per
 * bucket-aligned day so the delta equals exactly the per-day increment.
 */
async function seedEnergyDayBuckets(args: {
  from: Date;
  to: Date;
  totalKwh: number;
}): Promise<void> {
  const days = Math.round((args.to.getTime() - args.from.getTime()) / 86_400_000);
  const kwhPerDay = args.totalKwh / days;

  // Start counter at 1000 (arbitrary — only deltas matter)
  let counter = 1000;
  for (let d = 0; d < days; d++) {
    const dayStart = new Date(args.from.getTime() + d * 86_400_000 + 30 * 60_000); // +30 min
    const dayMid = new Date(dayStart.getTime() + 60_000); // +1 min so both land in same 5-min bucket
    await db.execute(sql`
      INSERT INTO machine_snapshots (timestamp, energy_consumption, machine_status, rms_curr_l1, rms_curr_l2, rms_curr_l3)
      VALUES
        (${dayStart.toISOString()}::timestamptz, ${counter}, 1, 10, 10, 10),
        (${dayMid.toISOString()}::timestamptz, ${counter + kwhPerDay}, 1, 10, 10, 10)
    `);
    counter += kwhPerDay;
  }

  // Refresh CAGG chain bottom-up over a wide window covering DST/timezone slack
  const refreshFrom = new Date(args.from.getTime() - 4 * 3600_000);
  const refreshTo = new Date(args.to.getTime() + 4 * 3600_000);
  await db.execute(sql`
    CALL refresh_continuous_aggregate('energy_5min', ${refreshFrom.toISOString()}::timestamptz, ${refreshTo.toISOString()}::timestamptz)
  `);
  await db.execute(sql`
    CALL refresh_continuous_aggregate('energy_1h', ${refreshFrom.toISOString()}::timestamptz, ${refreshTo.toISOString()}::timestamptz)
  `);
  await db.execute(sql`
    CALL refresh_continuous_aggregate('energy_1d', ${refreshFrom.toISOString()}::timestamptz, ${refreshTo.toISOString()}::timestamptz)
  `);
}

/**
 * Seeds `cyclesPerDay` ATTRIBUTED cycle_records rows per calendar day in
 * the [from, to) window. Each cycle is a 45-minute window starting at hour
 * (8 + cycleIndex) of the day. cycle_number is monotonic across all days.
 */
async function seedCycleRecords(args: {
  from: Date;
  to: Date;
  cyclesPerDay: number;
  kgPerCycle: number;
}): Promise<void> {
  const days = Math.round((args.to.getTime() - args.from.getTime()) / 86_400_000);
  let cycleNumber = 1;
  for (let d = 0; d < days; d++) {
    const dayBase = new Date(args.from.getTime() + d * 86_400_000);
    for (let c = 0; c < args.cyclesPerDay; c++) {
      const start = new Date(dayBase.getTime() + (8 + c) * 3600_000);
      const end = new Date(start.getTime() + 45 * 60_000);
      await db.execute(sql`
        INSERT INTO cycle_records
          (cycle_number, reset_epoch, started_at, ended_at,
           cycle_type, duration_seconds,
           energy_kwh, material_output_kg, attribution_status)
        VALUES (
          ${cycleNumber}, 0,
          ${start.toISOString()}::timestamptz,
          ${end.toISOString()}::timestamptz,
          1, 2700,
          ${args.kgPerCycle * 0.5},
          ${args.kgPerCycle},
          'ATTRIBUTED'
        )
      `);
      cycleNumber++;
    }
  }
}

describe('energyBaselineService integration', () => {
  beforeEach(async () => {
    await EnergyBaselineService.ensureSchema();
    await EnergyConfigService.ensureTable();
    // Two cleanup walls:
    //  - 2024-04..2024-07 fixtures (used by lockBaseline tests — see header)
    //  - 2099+ fixtures (used by Plan 01 raw-SQL FK + schema tests)
    await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id IN
      (SELECT baseline_id FROM energy_baselines
       WHERE period_from >= '2099-01-01'::timestamptz
          OR (period_from >= '2024-04-01'::timestamptz AND period_from < '2024-07-01'::timestamptz))`);
    await db.execute(sql`DELETE FROM energy_baselines
      WHERE period_from >= '2099-01-01'::timestamptz
         OR (period_from >= '2024-04-01'::timestamptz AND period_from < '2024-07-01'::timestamptz)`);
    await db.execute(sql`DELETE FROM machine_snapshots
      WHERE timestamp >= '2099-01-01'::timestamptz
         OR (timestamp >= '2024-04-01'::timestamptz AND timestamp < '2024-07-01'::timestamptz)`);
    await db.execute(sql`DELETE FROM cycle_records
      WHERE started_at >= '2099-01-01'::timestamptz
         OR (started_at >= '2024-04-01'::timestamptz AND started_at < '2024-07-01'::timestamptz)`);
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
