import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../db/index.js';
import { EnergyConfigService } from '../../services/energy/index.js';

/**
 * PHASE 19 — Tariff period [valid_from, valid_to) half-open interval contract.
 *
 * GREEN as of Plan 19-04 (energyConfigService + energyTariffService).
 *
 * Pins the behavior of:
 *
 *   - EnergyConfigService.ensureTable() (Plan 19-04) — seeds exactly one
 *     row in energy_config_periods on first boot per CONTEXT D-05 / ECFG-02.
 *
 *   - EnergyConfigService.getActivePeriod(at: Date) — half-open lookup.
 *     at == validFrom belongs to the NEW period; at == validTo belongs
 *     to the NEXT period.
 *
 *   - Reproducibility (ECFG-03/04): two calls with the same `at` must
 *     return deeply-equal results so a historical bucket can never be
 *     re-priced by a retroactive tariff change.
 *
 * These tests hit the real dev Postgres DB (wpt-iot-db-1) — each test
 * drops and recreates the relevant tables via EnergyConfigService.ensureTable()
 * so previous test state cannot leak in.
 */

describe('EnergyConfigService.getActivePeriod — half-open [validFrom, validTo) lookup', () => {
  beforeEach(async () => {
    // Wipe and recreate so every test starts from a known state.
    await db.execute(sql`DROP TABLE IF EXISTS energy_config_periods CASCADE`);
    await EnergyConfigService.ensureTable();
    // Clear the default seed row — this describe block provides its own fixture.
    await db.execute(sql`DELETE FROM energy_config_periods`);
    await db.execute(sql`
      INSERT INTO energy_config_periods (
        valid_from, valid_to,
        emission_factor_kg_per_kwh, emission_factor_year, emission_factor_source,
        tariff_mode, tariff_single_eur_per_kwh,
        tariff_bands_json, custom_holidays
      ) VALUES
        ('2024-01-01'::timestamptz, '2025-01-01'::timestamptz,
         0.279, 2024, 'ISPRA',
         'single', 0.25,
         '{}'::jsonb, '[]'::jsonb),
        ('2025-01-01'::timestamptz, NULL,
         0.285, 2025, 'ISPRA',
         'single', 0.30,
         '{}'::jsonb, '[]'::jsonb)
    `);
  });

  it('returns row 1 for 2024-06-15 (mid-interval of the first period)', async () => {
    const p = await EnergyConfigService.getActivePeriod(
      new Date('2024-06-15T00:00:00Z'),
    );
    expect(p).not.toBeNull();
    expect(p.tariffSingleEurPerKwh).toBe(0.25);
    expect(p.emissionFactorKgPerKwh).toBeCloseTo(0.279, 3);
  });

  it('returns row 2 for boundary 2025-01-01 (half-open: validTo is exclusive)', async () => {
    const p = await EnergyConfigService.getActivePeriod(
      new Date('2025-01-01T00:00:00Z'),
    );
    expect(p).not.toBeNull();
    expect(p.tariffSingleEurPerKwh).toBe(0.30);
  });

  it('returns row 2 for 2025-06-15 (mid-interval of the second, open-ended period)', async () => {
    const p = await EnergyConfigService.getActivePeriod(
      new Date('2025-06-15T00:00:00Z'),
    );
    expect(p).not.toBeNull();
    expect(p.tariffSingleEurPerKwh).toBe(0.30);
    expect(p.emissionFactorKgPerKwh).toBeCloseTo(0.285, 3);
  });

  it('two consecutive calls with the same `at` produce byte-identical results (reproducibility) (ECFG-03/04)', async () => {
    // ECFG-03 / ECFG-04 require cost and CO₂ to be frozen at aggregation
    // time. For that to be safe, two reads of the same bucket must never
    // disagree even at the byte level.
    const at = new Date('2024-06-15T00:00:00Z');
    const a = await EnergyConfigService.getActivePeriod(at);
    const b = await EnergyConfigService.getActivePeriod(at);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // JSON.stringify gives us deep equality that survives Date instance identity.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tariffSingleEurPerKwh).toBe(b.tariffSingleEurPerKwh);
    expect(a.emissionFactorKgPerKwh).toBe(b.emissionFactorKgPerKwh);
  });
});

describe('EnergyConfigService.ensureTable — first-boot seed (ECFG-02)', () => {
  beforeEach(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS energy_config_periods CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS energy_config CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS cycle_records CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS cycle_resets CASCADE`);
  });

  it('seeds exactly one period row with the default values on first boot (CONTEXT D-05)', async () => {
    // CONTEXT D-05: the seed row is single-rate 0.25 €/kWh + ISPRA 0.279
    // kgCO2/kWh, validFrom = 2024-01-01, validTo = NULL (open-ended).
    await EnergyConfigService.ensureTable();
    const rows = await db.execute(sql`
      SELECT
        valid_from                 AS "validFrom",
        valid_to                   AS "validTo",
        tariff_mode                AS "tariffMode",
        tariff_single_eur_per_kwh  AS "tariffSingleEurPerKwh",
        emission_factor_kg_per_kwh AS "emissionFactorKgPerKwh"
      FROM energy_config_periods
    `);
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0] as {
      validFrom: Date | string;
      validTo: Date | null;
      tariffMode: string;
      tariffSingleEurPerKwh: number | string;
      emissionFactorKgPerKwh: number | string;
    };
    expect(row.tariffMode).toBe('single');
    expect(Number(row.tariffSingleEurPerKwh)).toBe(0.25);
    expect(Number(row.emissionFactorKgPerKwh)).toBeCloseTo(0.279, 3);
    expect(row.validTo).toBeNull();
    expect(new Date(row.validFrom).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('is idempotent — a second ensureTable() call does not duplicate the seed row', async () => {
    await EnergyConfigService.ensureTable();
    await EnergyConfigService.ensureTable();
    const rows = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM energy_config_periods`,
    );
    const cnt = (rows.rows[0] as { cnt: number }).cnt;
    expect(cnt).toBe(1);
  });
});

afterAll(async () => {
  // Release the pool so vitest exits cleanly instead of hanging on open handles.
  await pool.end();
});
