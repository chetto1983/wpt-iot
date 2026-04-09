import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../db/index.js';
import { EnergyAttributionService } from '../../services/energyAttributionService.js';

/**
 * Phase 20 Plan 00 — unit test for EnergyAttributionService.sumAttributedKgInWindow
 *
 * BLOCKER-02 resolution (20-RESEARCH.md): Plan 02's computeSavings() depends
 * on sumAttributedKgInWindow to compute the ENPI denominator. This file pins
 * the contract: only cycles with `attribution_status = 'ATTRIBUTED' AND
 * material_output_kg > 0` inside the half-open window `[from, to)` contribute.
 *
 * Pattern mirrors wpt-iot/apps/backend/src/__tests__/energy/tariffPeriods.test.ts.
 * Fixtures live in the 2099+ far-future window so real dev data cannot leak in.
 */

describe('EnergyAttributionService.sumAttributedKgInWindow', () => {
  const FROM = new Date('2099-07-01T00:00:00Z');
  const TO = new Date('2099-07-31T00:00:00Z');

  beforeEach(async () => {
    await db.execute(
      sql`DELETE FROM cycle_records WHERE started_at >= '2099-01-01'::timestamptz`,
    );
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it('sumAttributedKgInWindow: sums only ATTRIBUTED cycles with output_kg > 0 inside window', async () => {
    // 3 ATTRIBUTED inside window — kg = [10, 20, 30] → total 60, count 3
    await db.execute(sql`
      INSERT INTO cycle_records (cycle_number, reset_epoch, started_at, ended_at,
                                 cycle_type, duration_seconds,
                                 energy_kwh, material_output_kg, attribution_status)
      VALUES
        (1, 0, '2099-07-05T08:00:00Z'::timestamptz, '2099-07-05T09:00:00Z'::timestamptz, 1, 3600, 5, 10, 'ATTRIBUTED'),
        (2, 0, '2099-07-10T08:00:00Z'::timestamptz, '2099-07-10T09:00:00Z'::timestamptz, 1, 3600, 8, 20, 'ATTRIBUTED'),
        (3, 0, '2099-07-20T08:00:00Z'::timestamptz, '2099-07-20T09:00:00Z'::timestamptz, 1, 3600, 12, 30, 'ATTRIBUTED')
    `);
    // 1 ABORTED inside window — excluded
    await db.execute(sql`
      INSERT INTO cycle_records (cycle_number, reset_epoch, started_at, ended_at,
                                 cycle_type, duration_seconds,
                                 energy_kwh, material_output_kg, attribution_status)
      VALUES (4, 0, '2099-07-25T08:00:00Z'::timestamptz, '2099-07-25T09:00:00Z'::timestamptz, 1, 3600, 3, 100, 'ABORTED')
    `);
    // 1 ATTRIBUTED OUTSIDE window — excluded
    await db.execute(sql`
      INSERT INTO cycle_records (cycle_number, reset_epoch, started_at, ended_at,
                                 cycle_type, duration_seconds,
                                 energy_kwh, material_output_kg, attribution_status)
      VALUES (5, 0, '2099-08-15T08:00:00Z'::timestamptz, '2099-08-15T09:00:00Z'::timestamptz, 1, 3600, 25, 50, 'ATTRIBUTED')
    `);

    const result = await EnergyAttributionService.sumAttributedKgInWindow({
      from: FROM,
      to: TO,
    });
    expect(result.totalKg).toBeCloseTo(60, 3);
    expect(result.totalCycles).toBe(3);
  });

  it('sumAttributedKgInWindow: empty window returns zeros', async () => {
    const result = await EnergyAttributionService.sumAttributedKgInWindow({
      from: FROM,
      to: TO,
    });
    expect(result.totalKg).toBe(0);
    expect(result.totalCycles).toBe(0);
  });
});
