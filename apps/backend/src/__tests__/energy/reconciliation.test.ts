import { describe, it, expect, beforeEach } from 'vitest';
import { db, pool } from '../../db/index.js';
import { sql } from 'drizzle-orm';

/**
 * PHASE 19 — CA-on-CA reconciliation invariant.
 *
 * Pitfall B from RESEARCH.md: TimescaleDB hierarchical continuous aggregates
 * can silently stop materializing (Issue #7524) or carry sub-bucket accuracy
 * bugs in FIRST() (Issue #5341). The mitigation is architectural: assert at
 * every level that the parent CAGG sums to the child CAGG within tolerance.
 *
 *   1. Pure SQL invariant — sum(energy_1h.kwh_delta) over a day must equal
 *      energy_1d.kwh_delta for that day, within ±0.1 kWh. Enabled by Plan
 *      19-09 (this file); turns GREEN once the CA-on-CA chain exists and
 *      the seeded ramp refreshes end-to-end.
 *
 *   2. Service helper — EnergyAggregateService.getReconciliation({from,to})
 *      returns the per-day reconciliation report consumed by Phase 21's
 *      reconciliation widget; ratio = (attributedKwh + idleKwh) / meterKwh
 *      must be ≥ 0.98 for a clean simulator day. Stays RED — Plan 19-10
 *      wires the service helper.
 */

describe('energy CAGG reconciliation — sum(child) ≈ parent within ±0.1 kWh', () => {
  // Test-only date, ahead of any simulator emission, so seeding never
  // collides with dev-DB noise. The bucket alignment for energy_1d is
  // Europe/Rome, so the "day" we seed must be expressed in local time
  // bounds to line up with the daily bucket. Europe/Rome is UTC+2 during
  // CEST (which covers 2026-04-08), so the local day [2026-04-08 00:00,
  // 2026-04-09 00:00) corresponds to UTC [2026-04-07 22:00, 2026-04-08
  // 22:00). We seed 288 snapshots across that 24-hour local day.
  const LOCAL_DAY_START_UTC = new Date('2026-04-07T22:00:00.000Z');
  const LOCAL_DAY_END_UTC = new Date('2026-04-08T22:00:00.000Z');
  const BUCKET_COUNT = 288; // 24h / 5min
  const RAMP_START_KWH = 1000;
  const RAMP_END_KWH = 1100; // 100 kWh total over the day
  const EXPECTED_DAY_KWH = RAMP_END_KWH - RAMP_START_KWH;
  const PER_BUCKET_KWH = EXPECTED_DAY_KWH / BUCKET_COUNT; // 0.3472...
  // Seed 2 samples per 5-min bucket — one at the start of the bucket and one
  // near the end. The kwh_delta = last - first of the bucket is therefore
  // exactly PER_BUCKET_KWH, so summed over 288 buckets the total is exactly
  // EXPECTED_DAY_KWH. A single-sample-per-bucket seed would produce
  // kwh_delta = 0 for every bucket at Level 1 (last == first), which is a
  // dead giveaway that the seed density is wrong for this kind of test.

  beforeEach(async () => {
    // Clean window in raw hypertable. We delete one extra hour on each side
    // to be safe if the test writes anything outside the exact 24h slot.
    await db.execute(sql`
      DELETE FROM machine_snapshots
      WHERE timestamp >= ${new Date(LOCAL_DAY_START_UTC.getTime() - 3600_000)}
        AND timestamp <  ${new Date(LOCAL_DAY_END_UTC.getTime() + 3600_000)}
    `);
  });

  it('288 snapshots over 24 hours (linear ramp 1000→1100 kWh) — sum(energy_1h.kwh_delta) == energy_1d.kwh_delta within ±0.1 (GREEN — Plan 19-09)', async () => {
    // Seed 2 snapshots inside each 5-minute bucket (576 total), so every
    // Level-1 kwh_delta is a non-zero `last - first`. Sample A lives 30
    // seconds into the bucket, sample B lives 4 minutes 30 seconds in.
    // Sample A has the cumulative kWh at the start of the bucket's delta,
    // Sample B has the value after one PER_BUCKET_KWH increment. The
    // energy_consumption field is therefore a stepwise ramp — it stays flat
    // across bucket boundaries (so no cross-bucket delta is lost) and jumps
    // by PER_BUCKET_KWH inside each bucket.
    //
    // machine_snapshots has no NOT NULL columns beyond the serial id (auto)
    // and timestamp. In the dev DB the table is a minimal subset
    // (id, timestamp, energy_consumption, rms_curr_l1..l3, machine_status)
    // so the INSERT only names columns known to exist everywhere.
    for (let bucket = 0; bucket < BUCKET_COUNT; bucket++) {
      const bucketStartMs = LOCAL_DAY_START_UTC.getTime() + bucket * 5 * 60 * 1000;
      const startKwh = RAMP_START_KWH + bucket * PER_BUCKET_KWH;
      const endKwh = startKwh + PER_BUCKET_KWH;
      const tsA = new Date(bucketStartMs + 30_000);         // 00:30 into bucket
      const tsB = new Date(bucketStartMs + 270_000);        // 04:30 into bucket
      await db.execute(sql`
        INSERT INTO machine_snapshots (timestamp, energy_consumption, machine_status)
        VALUES (${tsA}, ${startKwh}, 1)
      `);
      await db.execute(sql`
        INSERT INTO machine_snapshots (timestamp, energy_consumption, machine_status)
        VALUES (${tsB}, ${endKwh}, 1)
      `);
    }

    // Refresh the 3 levels of the CA-on-CA chain in strict order. Each call
    // must cover a window strictly wider than the data window at that level
    // so TimescaleDB refreshes the relevant buckets. The upper levels need
    // the window padded because their buckets can be much larger than a day.
    // Explicit ::timestamptz casts are required because Postgres cannot
    // infer parameter types inside a CALL argument list the way it does
    // for SELECT — the server rejects the prepared statement otherwise.
    const refreshWindowStart = new Date(LOCAL_DAY_START_UTC.getTime() - 2 * 3600_000);
    const refreshWindowEndForSmall = new Date(LOCAL_DAY_END_UTC.getTime() + 2 * 3600_000);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_5min', ${refreshWindowStart}::timestamptz, ${refreshWindowEndForSmall}::timestamptz)
    `);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_1h',   ${refreshWindowStart}::timestamptz, ${refreshWindowEndForSmall}::timestamptz)
    `);
    // For energy_1d, the refresh window must align to day boundaries in
    // Europe/Rome. We expand by 1 day on each side to be safe.
    const dayRefreshStart = new Date(LOCAL_DAY_START_UTC.getTime() - 24 * 3600_000);
    const dayRefreshEnd = new Date(LOCAL_DAY_END_UTC.getTime() + 24 * 3600_000);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_1d',   ${dayRefreshStart}::timestamptz, ${dayRefreshEnd}::timestamptz)
    `);

    // Query the chained invariant: the sum of the 24 hourly deltas covering
    // the seeded day must equal the single daily delta row for that day,
    // within ±0.1 kWh.
    const hourlySumRows = await db.execute(sql`
      SELECT COALESCE(sum(kwh_delta), 0)::float8 AS total
      FROM energy_1h
      WHERE bucket_1h >= ${LOCAL_DAY_START_UTC}
        AND bucket_1h <  ${LOCAL_DAY_END_UTC}
    `);
    const dailyRows = await db.execute(sql`
      SELECT COALESCE(kwh_delta, 0)::float8 AS total
      FROM energy_1d
      WHERE bucket_1d = ${LOCAL_DAY_START_UTC}
    `);

    const hourlySum = Number((hourlySumRows.rows[0] as { total: number | string }).total);
    const dailyTotal = Number((dailyRows.rows[0] as { total: number | string }).total);

    // Primary invariant: the two numbers match within the tolerance. Anything
    // wider would let a CA-on-CA refresh-drift bug land undetected.
    expect(Math.abs(hourlySum - dailyTotal)).toBeLessThanOrEqual(0.1);

    // Sanity check: both numbers must be approximately the known seeded
    // delta. The linear ramp from 1000 → 1100 over 287 intervals means the
    // last bucket of the day ends at energy_consumption = 1100, so the full
    // day delta is 100 kWh (within float rounding).
    expect(dailyTotal).toBeGreaterThanOrEqual(EXPECTED_DAY_KWH - 1);
    expect(dailyTotal).toBeLessThanOrEqual(EXPECTED_DAY_KWH + 1);
    expect(hourlySum).toBeGreaterThanOrEqual(EXPECTED_DAY_KWH - 1);
    expect(hourlySum).toBeLessThanOrEqual(EXPECTED_DAY_KWH + 1);

    // Release the pg pool so vitest can exit cleanly.
    await pool.end().catch(() => undefined);
  });

  it.skip('EnergyAggregateService.getReconciliation({from,to}) returns ratio >= 0.98 on a clean seeded day (RED — Plan 19-10)', async () => {
    /* BODY — enable in Plan 19-10:
    const { EnergyAggregateService } = await import('../../services/energyAggregateService.js');
    const day = new Date('2026-04-07T00:00:00Z');
    const nextDay = new Date(day.getTime() + 24 * 3600 * 1000);
    const result = await EnergyAggregateService.getReconciliation({ from: day, to: nextDay });
    expect(result).toBeDefined();
    expect(result.meterKwh).toBeGreaterThan(0);
    expect(result.attributedKwh).toBeGreaterThanOrEqual(0);
    expect(result.idleKwh).toBeGreaterThanOrEqual(0);
    expect(result.unknownKwh).toBeGreaterThanOrEqual(0);
    // ratio = (attributedKwh + idleKwh) / meterKwh
    const ratio = (result.attributedKwh + result.idleKwh) / result.meterKwh;
    expect(ratio).toBeGreaterThanOrEqual(0.98);
    expect(ratio).toBeLessThanOrEqual(1.02);
    // Also exposed pre-computed by the service so callers don't have to do
    // the division themselves.
    expect(result.ratio).toBeGreaterThanOrEqual(0.98);
    */
  });
});
