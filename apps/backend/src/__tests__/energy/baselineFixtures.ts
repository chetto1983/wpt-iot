/**
 * Phase 20 — shared fixtures / helpers for the baseline integration tests.
 *
 * Split out of the original `energyBaseline.integration.test.ts` (WR-03 —
 * file-size cap violation: 877 lines > 500). The tests that used to live in
 * that single file are now in:
 *  - energyBaselineSchema.test.ts     (Plan 01)
 *  - energyBaselineLockFreeze.test.ts (Plan 03)
 *  - energyBaselineRoutes.test.ts     (Plan 04)
 *  - energyBaselinePredates.test.ts   (Plan 05)
 *
 * This module owns the cross-file helpers: test-server builder, date-wall
 * constants, data seeders, and the shared beforeEach cleanup routine. It
 * does NOT run any tests itself (no `describe`/`it`). It also does NOT end
 * the pool — each test file's `afterAll` is responsible for its own close.
 *
 * Prereq: `cd wpt-iot && docker compose up -d db` before running.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { energyRoutes } from '../../routes/energy.js';

/** Build an isolated Fastify test server wired to the energy plugin. */
async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes);
  await app.ready();
  return app;
}

/**
 * Phase 20 fixture date wall.
 *
 * Plan 00 originally pinned 2099+ for test isolation, but `lockBaseline`
 * enforces a hard "period_from must NOT be in the future" guard
 * (BaselineTooShortError reason='period_from_future'). 2099 is in the
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
export const BASELINE_FROM = new Date('2024-05-01T00:00:00Z');
export const BASELINE_TO = new Date('2024-05-31T00:00:00Z');
export const MEASUREMENT_FROM = new Date('2024-06-01T00:00:00Z');
export const MEASUREMENT_TO = new Date('2024-06-30T00:00:00Z');

/**
 * Seeds N days of machine_snapshots + refreshes the CAGG chain so energy_1d
 * has data in the [from, to) window. Mirrors aggregate.fixture.test.ts:
 * the energy_5min CAGG computes `last(energy_consumption) - first(energy_consumption)`
 * per bucket; chained sum to energy_1h then energy_1d gives the daily kwh delta.
 *
 * Two snapshots per day at 00:30 and 00:31 UTC (same 5-min CAGG bucket),
 * energy_consumption rising by `totalKwh / days` between them and carrying
 * forward across days. The +0.5h offsets keep both samples inside the SAME
 * 5-min CAGG bucket per bucket-aligned day so the delta equals exactly the
 * per-day increment.
 */
export async function seedEnergyDayBuckets(args: {
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
export async function seedCycleRecords(args: {
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

/**
 * beforeEach cleanup for every baseline integration test. Scoped to the
 * 2024-04..2024-07 fixture wall + the legacy 2099+ raw-SQL schema tests.
 * Safe to call repeatedly; no cascading wipes outside those windows.
 */
export async function cleanupBaselineArea(): Promise<void> {
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
}
