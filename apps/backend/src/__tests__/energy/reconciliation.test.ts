import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { EnergyAggregateService } from '../../services/energyAggregateService.js';

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
    // Also clean cycle_records in the same window so Test 2's
    // getReconciliation query sees only whatever the test itself inserted.
    // Plan 19-10 ships getReconciliation without cycle_records wiring
    // (Plan 19-06 does that); the reconciliation baseline here is the
    // "no cycles yet" path where idleKwh absorbs 100% of meterKwh.
    await db.execute(sql`
      DELETE FROM cycle_records
      WHERE started_at >= ${new Date(LOCAL_DAY_START_UTC.getTime() - 3600_000)}
        AND started_at <  ${new Date(LOCAL_DAY_END_UTC.getTime() + 3600_000)}
    `);
  });

  // Release the pg pool once after the whole suite — NOT inside each
  // test. Plan 19-09 used an in-test pool.end() when only one case was
  // live; now that Test 2 joins the party, closing the pool mid-suite
  // would break the second case.
  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  /**
   * Shared seed+refresh helper used by both the CAGG invariant test and
   * the getReconciliation service-level test. Seeds 576 snapshots across
   * the Europe/Rome local day 2026-04-08 such that
   * sum(energy_1d.kwh_delta) = EXPECTED_DAY_KWH (100) exactly, then
   * refreshes the 3 lower CAGG levels in strict order.
   *
   * Kept as a closure so both tests share one implementation — any future
   * fix to the seed density or refresh window semantics only has to land
   * in one place.
   */
  async function seedAndRefreshCleanDay(): Promise<void> {
    for (let bucket = 0; bucket < BUCKET_COUNT; bucket++) {
      const bucketStartMs = LOCAL_DAY_START_UTC.getTime() + bucket * 5 * 60 * 1000;
      const startKwh = RAMP_START_KWH + bucket * PER_BUCKET_KWH;
      const endKwh = startKwh + PER_BUCKET_KWH;
      const tsA = new Date(bucketStartMs + 30_000);
      const tsB = new Date(bucketStartMs + 270_000);
      await db.execute(sql`
        INSERT INTO machine_snapshots (timestamp, energy_consumption, machine_status, rms_curr_l1, rms_curr_l2, rms_curr_l3)
        VALUES (${tsA}, ${startKwh}, 1, 10, 10, 10)
      `);
      await db.execute(sql`
        INSERT INTO machine_snapshots (timestamp, energy_consumption, machine_status, rms_curr_l1, rms_curr_l2, rms_curr_l3)
        VALUES (${tsB}, ${endKwh}, 1, 10, 10, 10)
      `);
    }
    const refreshWindowStart = new Date(LOCAL_DAY_START_UTC.getTime() - 2 * 3600_000);
    const refreshWindowEndForSmall = new Date(LOCAL_DAY_END_UTC.getTime() + 2 * 3600_000);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_5min', ${refreshWindowStart}::timestamptz, ${refreshWindowEndForSmall}::timestamptz)
    `);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_1h',   ${refreshWindowStart}::timestamptz, ${refreshWindowEndForSmall}::timestamptz)
    `);
    const dayRefreshStart = new Date(LOCAL_DAY_START_UTC.getTime() - 24 * 3600_000);
    const dayRefreshEnd = new Date(LOCAL_DAY_END_UTC.getTime() + 24 * 3600_000);
    await db.execute(sql`
      CALL refresh_continuous_aggregate('energy_1d',   ${dayRefreshStart}::timestamptz, ${dayRefreshEnd}::timestamptz)
    `);
  }

  it('288 snapshots over 24 hours (linear ramp 1000→1100 kWh) — sum(energy_1h.kwh_delta) == energy_1d.kwh_delta within ±0.1 (GREEN — Plan 19-09)', async () => {
    // Seed 2 snapshots inside each 5-minute bucket (576 total), so every
    // Level-1 kwh_delta is a non-zero `last - first`. Seed/refresh is
    // centralized in seedAndRefreshCleanDay() so Test 2 (getReconciliation)
    // can reuse the exact same fixture.
    //
    // machine_snapshots has no NOT NULL columns beyond the serial id (auto)
    // and timestamp. In the dev DB the table is a minimal subset
    // (id, timestamp, energy_consumption, rms_curr_l1..l3, machine_status)
    // so the helper INSERT only names columns known to exist everywhere.
    await seedAndRefreshCleanDay();

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
  });

  /**
   * Service-level reconciliation test (Plan 19-10). Seeds the same
   * 100-kWh clean day and calls EnergyAggregateService.getReconciliation.
   *
   * Expected shape:
   *   { meterKwh, cycleKwh, idleKwh, unknownKwh, ratio }
   *
   * In Plan 19-10 the cycle_records table is empty for this window
   * (Plan 19-06 wires the cycle persister), so cycleKwh = unknownKwh = 0
   * and idleKwh absorbs the full meterKwh ≈ 100. Therefore:
   *
   *   ratio = (cycleKwh + idleKwh) / meterKwh
   *         = (0 + 100) / 100
   *         = 1.0
   *
   * This is the baseline reconciliation contract: a clean window with no
   * persisted cycles still reports ratio = 1.0, not NaN / 0 / Infinity.
   * Once Plan 19-06 wires the persister, this test will need to seed a
   * cycle_records row too so `cycleKwh > 0`; until then, the "no cycles
   * yet" path is the correct assertion and Plan 19-10 closes the
   * read-side of ENRG-06.
   */
  it('EnergyAggregateService.getReconciliation({from,to}) returns ratio >= 0.98 on a clean seeded day (GREEN — Plan 19-10)', async () => {
    await seedAndRefreshCleanDay();

    const result = await EnergyAggregateService.getReconciliation({
      from: LOCAL_DAY_START_UTC,
      to: LOCAL_DAY_END_UTC,
    });

    expect(result).toBeDefined();
    expect(result.meterKwh).toBeGreaterThan(0);
    // Meter total should match the seeded 100 kWh ± 1 float rounding.
    expect(result.meterKwh).toBeGreaterThanOrEqual(EXPECTED_DAY_KWH - 1);
    expect(result.meterKwh).toBeLessThanOrEqual(EXPECTED_DAY_KWH + 1);

    // Plan 19-10 ships without the cycle persister (Plan 19-06). The
    // cycle_records table is empty for this window, so attribution
    // columns must be exactly 0 and idleKwh must absorb the entire meter
    // total.
    expect(result.cycleKwh).toBe(0);
    expect(result.unknownKwh).toBe(0);
    expect(result.idleKwh).toBeGreaterThanOrEqual(EXPECTED_DAY_KWH - 1);
    expect(result.idleKwh).toBeLessThanOrEqual(EXPECTED_DAY_KWH + 1);

    // The ratio contract — the central assertion of ENRG-06. On a clean
    // day with or without cycle persister wiring, (cycleKwh + idleKwh) /
    // meterKwh must be >= 0.98. Here it should be exactly 1.0 within
    // float rounding.
    expect(result.ratio).toBeGreaterThanOrEqual(0.98);
    expect(result.ratio).toBeLessThanOrEqual(1.02);
  });
});
