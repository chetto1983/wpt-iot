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
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { EnergyBaselineService, EnergyConfigService } from '../services/energy/index.js';
import { energyRoutes } from '../routes/energy.js';

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes);
  await app.ready();
  return app;
}

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

  it('POST baseline/lock happy path', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'route-test baseline',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          justification: 'happy path',
          normalizationVariables: { temp: 20 },
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        baseline: { baselineId: number };
        evidence: { totalKwh: number };
        warnings: string[];
      };
      expect(body.baseline.baselineId).toBeGreaterThan(0);
      expect(body.evidence.totalKwh).toBeGreaterThan(0);
      expect(Array.isArray(body.warnings)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('POST baseline/lock 422 on overlap and short window', async () => {
    const app = await buildTestServer();
    try {
      // 10-day window in 2024 (past, so the future-date guard does not fire) → too short (< 14 days)
      const response = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'too-short',
          periodFrom: new Date('2024-04-01T00:00:00Z').toISOString(),
          periodTo: new Date('2024-04-10T00:00:00Z').toISOString(),
          normalizationVariables: {},
        },
      });
      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        error: { code: string; message: string; details: { reason?: string } };
      };
      expect(body.error.code).toBe('BASELINE_TOO_SHORT');
      // BaselineTooShortError details.reason discriminator (WARNING 2)
      expect(body.error.details.reason).toBe('window_too_short');
    } finally {
      await app.close();
    }
  });

  it('POST baseline/:id/retire returns 204', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      // Lock first
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'retire-route-test',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: {},
        },
      });
      expect(lockRes.statusCode).toBe(201);
      const baselineId = (
        lockRes.json() as { baseline: { baselineId: number } }
      ).baseline.baselineId;

      // Retire
      const retireRes = await app.inject({
        method: 'POST',
        url: `/api/energy/baseline/${baselineId}/retire`,
      });
      expect(retireRes.statusCode).toBe(204);

      // Retire nonexistent → 404
      const notFoundRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/999999/retire',
      });
      expect(notFoundRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET savings default', async () => {
    // Seed baseline + measurement windows.
    //
    // Baseline window: 2024-05-01..2024-05-31 = 30 days × 1 cycle × 20 kg = 600 kg,
    // 300 kWh → baselineEnpi = 0.5 kwh/kg.
    // Measurement window: 2024-06-01..2024-06-30 = 29 days × 1 cycle × 20 kg = 580 kg.
    // Target: -10% deltaPct → measurementEnpi = 0.45 → totalKwh = 580 * 0.45 = 261.
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });
    await seedEnergyDayBuckets({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      totalKwh: 261,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      // Lock a baseline
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'savings-default',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: { temp: 20 },
        },
      });
      expect(lockRes.statusCode).toBe(201);

      // Request savings WITHOUT baseline_id (default resolution)
      const savingsRes = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}`,
      });
      expect(savingsRes.statusCode).toBe(200);
      const body = savingsRes.json() as {
        deltaPct: number;
        confidence: string;
        excludedStatuses: string[];
      };
      // 10% less energy for the same production → -10% deltaPct (within rounding)
      expect(body.deltaPct).toBeCloseTo(-10, 0);
      expect(body.confidence).toBe('HIGH');
      expect(body.excludedStatuses).toContain('ABORTED');
    } finally {
      await app.close();
    }
  });

  it('GET savings detail=1', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });
    await seedEnergyDayBuckets({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      totalKwh: 270,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'savings-detail',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: { temp: 20 },
        },
      });
      const baselineId = (
        lockRes.json() as { baseline: { baselineId: number } }
      ).baseline.baselineId;

      const savingsRes = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(
          MEASUREMENT_TO.toISOString(),
        )}&baseline_id=${baselineId}&detail=1`,
      });
      expect(savingsRes.statusCode).toBe(200);
      const body = savingsRes.json() as {
        dailySeries: Array<{
          date: string;
          baselineKwhPerKg: number;
          measurementKwhPerKg: number;
        }>;
      };
      expect(Array.isArray(body.dailySeries)).toBe(true);
      expect(body.dailySeries.length).toBeGreaterThan(0);
      // Every point has the constant baseline reference line
      const baselineRefs = new Set(body.dailySeries.map((p) => p.baselineKwhPerKg));
      expect(baselineRefs.size).toBe(1); // constant value across the series
    } finally {
      await app.close();
    }
  });

  it('GET savings 204', async () => {
    // beforeEach already wiped 2024-* and 2099+ baselines; no lock happens
    // in this test so getActiveBaseline() must return null and the route
    // must respond 204 with no body.
    const app = await buildTestServer();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}`,
      });
      expect(response.statusCode).toBe(204);
      // 204 MUST have no body
      expect(response.body).toBe('');
    } finally {
      await app.close();
    }
  });

  it('error code mapping', async () => {
    // GET /savings with a measurement window that overlaps the baseline →
    // 422 BASELINE_OVERLAP. Exercises the mapBaselineErrorToResponse helper.
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'overlap-mapping-test',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: {},
        },
      });
      const baselineId = (
        lockRes.json() as { baseline: { baselineId: number } }
      ).baseline.baselineId;

      // Measurement window that overlaps the baseline (same from date)
      const response = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          BASELINE_FROM.toISOString(),
        )}&to=${encodeURIComponent(
          new Date(BASELINE_FROM.getTime() + 20 * 86_400_000).toISOString(),
        )}&baseline_id=${baselineId}`,
      });
      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        error: { code: string; message: string; details: unknown };
      };
      expect(body.error.code).toBe('BASELINE_OVERLAP');
      expect(body.error.details).toBeDefined();
    } finally {
      await app.close();
    }
  });

  // --- Plan 05: startup validator + predates-data ---
  it('startup validator fatal log', async () => {
    // First seed fresh data so energy_1d has a known MIN bucket. The CAGG may
    // have stale buckets from prior tests (1999-*, other 2024-*, 2099-*) that
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

  it('BASELINE_PREDATES_DATA via computeSavings returns 422', async () => {
    // Seed baseline window normally so lockBaseline's own validation passes
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });
    // Measurement window — 29 days in June 2024, past the baseline window
    await seedEnergyDayBuckets({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      totalKwh: 270,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    // Lock the baseline over the real seeded window (passes lockBaseline guards)
    const lockRes = await EnergyBaselineService.lockBaseline({
      label: 'predate-route-test',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      normalizationVariables: { temp: 20 },
    });
    const baselineId = lockRes.baseline.baselineId;

    // Manually rewind period_from to a date EARLIER than the oldest energy_1d
    // bucket. Read the current MIN(bucket_1d) at runtime so the test is
    // resilient to stale CAGG chunks that survive between test runs (the
    // beforeEach wall deletes machine_snapshots inside 2024-04..2024-07 and
    // 2099+, but cannot DELETE the CAGG directly). One day earlier makes the
    // "predates" check deterministic.
    const minRes = await db.execute(sql`
      SELECT MIN(bucket_1d) AS oldest FROM energy_1d
    `);
    const oldestRaw = (minRes.rows[0] as { oldest: string | Date | null } | undefined)?.oldest;
    expect(oldestRaw).not.toBeNull();
    const oldestBucket = oldestRaw instanceof Date ? oldestRaw : new Date(oldestRaw as string);
    const EARLIER = new Date(oldestBucket.getTime() - 86_400_000);
    await db.execute(sql`
      UPDATE energy_baselines
      SET period_from = ${EARLIER.toISOString()}::timestamptz
      WHERE baseline_id = ${baselineId}
    `);

    // The route should 422 BASELINE_PREDATES_DATA because the per-request
    // validateOldestDataAvailability inside computeSavings catches it
    const app = await buildTestServer();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(
          MEASUREMENT_TO.toISOString(),
        )}&baseline_id=${baselineId}`,
      });
      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        error: { code: string; details: unknown };
      };
      expect(body.error.code).toBe('BASELINE_PREDATES_DATA');
    } finally {
      await app.close();
      // Explicit cleanup — period_from may be outside the beforeEach cleanup
      // walls after the rewind.
      await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id = ${baselineId}`);
      await db.execute(sql`DELETE FROM energy_baselines WHERE baseline_id = ${baselineId}`);
    }
  });
});
