import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type {
  IEnergyConfig,
  IEnergyConfigPeriod,
  ITariffBands,
} from '@wpt/types';
import {
  DEFAULT_EMISSION_FACTOR_KG_PER_KWH,
  DEFAULT_TARIFF_SINGLE_EUR_PER_KWH,
  DEFAULT_TARIFF_VALID_FROM_ISO,
} from '@wpt/types';

/**
 * EnergyConfigService — singleton config (energy_config, id=1) + versioned
 * tariff/emission periods (energy_config_periods).
 *
 * ALL table creation is DIRECT SQL via `db.execute(sql\`CREATE TABLE IF NOT EXISTS ...\`)`.
 * NEVER via drizzle generated migrations or drizzle schema push. Pattern mirrors
 * `wpt-iot/apps/backend/src/mqtt/configService.ts` exactly. See CLAUDE.md
 * ("NEVER RUN DESTRUCTIVE DB COMMANDS"), 19-CONTEXT.md decision D-09 (all
 * schema changes are idempotent direct SQL), PROJECT.md Key Decisions, and
 * ROADMAP Scope Wall for the rationale: drizzle-kit has no awareness of
 * TimescaleDB continuous aggregates and would attempt destructive diffs
 * against the existing `snapshots_*` views.
 *
 * Closes ECFG-01..06.
 *
 * Service also creates `cycle_records` and `cycle_resets` at boot so Plan
 * 19-06 (the cycle persister) can insert into them without racing a later
 * `ensureSchema()` call. Plan 19-07's `EnergyAttributionService.ensureSchema()`
 * will add any ALTER TABLE migrations it needs on top of these shells.
 */
export class EnergyConfigService {
  /**
   * Create the 4 Phase 19 energy tables if they do not exist, and seed the
   * default rows per 19-CONTEXT.md D-05. Idempotent — safe to call on every
   * backend boot. Must be invoked from `apps/backend/src/index.ts` right
   * after `MqttConfigService.ensureTable()`.
   */
  static async ensureTable(): Promise<void> {
    // ─── energy_config (singleton) ───────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS energy_config (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(200) NOT NULL DEFAULT '',
        machine_serial VARCHAR(100) NOT NULL DEFAULT '',
        machine_model VARCHAR(100) NOT NULL DEFAULT '',
        install_site VARCHAR(200) NOT NULL DEFAULT '',
        cosphi REAL NOT NULL DEFAULT 0.85,
        shift_start_hour INTEGER NOT NULL DEFAULT 6,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const singletonExists = await db.execute(
      sql`SELECT id FROM energy_config WHERE id = 1`,
    );
    if (singletonExists.rows.length === 0) {
      await db.execute(sql`INSERT INTO energy_config (id) VALUES (1)`);
    }

    // ─── energy_config_periods (versioned, half-open interval) ───────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS energy_config_periods (
        id SERIAL PRIMARY KEY,
        valid_from TIMESTAMPTZ NOT NULL,
        valid_to TIMESTAMPTZ,
        emission_factor_kg_per_kwh REAL NOT NULL DEFAULT 0.279,
        emission_factor_year INTEGER NOT NULL DEFAULT 2024,
        emission_factor_source VARCHAR(200) NOT NULL DEFAULT 'ISPRA',
        tariff_mode VARCHAR(16) NOT NULL DEFAULT 'single',
        tariff_single_eur_per_kwh REAL NOT NULL DEFAULT 0.25,
        tariff_bands_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        custom_holidays JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS energy_config_periods_valid_from_idx
        ON energy_config_periods (valid_from)
    `);

    // Seed the default period only if the table is empty (ECFG-02).
    // Values mirror 19-CONTEXT.md D-05 and the DEFAULT_* constants in
    // @wpt/types — kept DRY via parameterized SQL, no string concat.
    const existingPeriods = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM energy_config_periods`,
    );
    const cntRow = existingPeriods.rows[0] as { cnt: number } | undefined;
    const cnt = cntRow?.cnt ?? 0;
    if (cnt === 0) {
      await db.execute(sql`
        INSERT INTO energy_config_periods (
          valid_from, valid_to,
          emission_factor_kg_per_kwh, emission_factor_year, emission_factor_source,
          tariff_mode, tariff_single_eur_per_kwh,
          tariff_bands_json, custom_holidays
        ) VALUES (
          ${DEFAULT_TARIFF_VALID_FROM_ISO}::timestamptz, NULL,
          ${DEFAULT_EMISSION_FACTOR_KG_PER_KWH}, 2024, 'ISPRA',
          'single', ${DEFAULT_TARIFF_SINGLE_EUR_PER_KWH},
          '{}'::jsonb, '[]'::jsonb
        )
      `);
    }

    // ─── cycle_records (sparse — one row per attributed cycle) ───────────
    // Composite cycle identity = (reset_epoch, cycle_number) — see ENRG-04
    // and 19-CONTEXT.md D-10. attribution_status values: ATTRIBUTED,
    // ABORTED, TOO_SHORT, DATA_GAP, UNKNOWN (AttributionStatus enum in
    // @wpt/types). kwh_per_kg is NULLABLE — never Infinity (ENRG-09).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cycle_records (
        id SERIAL PRIMARY KEY,
        reset_epoch INTEGER NOT NULL DEFAULT 0,
        cycle_number INTEGER NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ NOT NULL,
        cycle_type INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        material_input_kg REAL,
        material_output_kg REAL,
        energy_kwh REAL,
        water_l REAL,
        avg_rms_current REAL,
        kwh_per_kg REAL,
        attribution_status VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        serial_number VARCHAR(20),
        order_number VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cycle_records_started_at_idx
        ON cycle_records (started_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cycle_records_cycle_type_idx
        ON cycle_records (cycle_type)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cycle_records_composite_idx
        ON cycle_records (reset_epoch, cycle_number)
    `);

    // ─── cycle_resets (counter rollover anchors) ─────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cycle_resets (
        id SERIAL PRIMARY KEY,
        reset_epoch INTEGER NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        last_completed_cycles_before INTEGER NOT NULL,
        new_completed_cycles_after INTEGER NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cycle_resets_observed_at_idx
        ON cycle_resets (observed_at)
    `);

    // ─── Phase 24: ALTER TABLE cycle_records — add V03 cycle register columns ─
    // Idempotent: ADD COLUMN IF NOT EXISTS is not supported in PG <12,
    // so we use a DO block that checks information_schema.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'start_energy_kwh') THEN
          ALTER TABLE cycle_records ADD COLUMN start_energy_kwh REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'end_energy_kwh') THEN
          ALTER TABLE cycle_records ADD COLUMN end_energy_kwh REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'start_water_l') THEN
          ALTER TABLE cycle_records ADD COLUMN start_water_l REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'end_water_l') THEN
          ALTER TABLE cycle_records ADD COLUMN end_water_l REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'containers') THEN
          ALTER TABLE cycle_records ADD COLUMN containers INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'operator') THEN
          ALTER TABLE cycle_records ADD COLUMN operator VARCHAR(20);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'cycle_status_label') THEN
          ALTER TABLE cycle_records ADD COLUMN cycle_status_label VARCHAR(16);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'gross_input_kg') THEN
          ALTER TABLE cycle_records ADD COLUMN gross_input_kg REAL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cycle_records' AND column_name = 'published_at') THEN
          ALTER TABLE cycle_records ADD COLUMN published_at TIMESTAMPTZ;
        END IF;
      END $$;
    `);
  }

  /**
   * Read the singleton energy_config row. Returns a fully-populated
   * IEnergyConfig. Throws if the row is missing — caller must have run
   * ensureTable() at boot.
   */
  static async getConfig(): Promise<IEnergyConfig> {
    const result = await db.execute(sql`
      SELECT
        id,
        customer_name     AS "customerName",
        machine_serial    AS "machineSerial",
        machine_model     AS "machineModel",
        install_site      AS "installSite",
        cosphi,
        shift_start_hour  AS "shiftStartHour",
        updated_at        AS "updatedAt"
      FROM energy_config
      WHERE id = 1
      LIMIT 1
    `);
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        'energy_config singleton row missing — EnergyConfigService.ensureTable() not run?',
      );
    }
    return row as unknown as IEnergyConfig;
  }

  /**
   * Update any subset of the singleton energy_config fields. Unknown fields
   * are ignored silently — column whitelist is enforced by this method, NOT
   * by the caller. `updatedAt` is always refreshed to the DB clock.
   *
   * Phase 23 `/settings/energy` will wire a SUPER_ADMIN route that calls
   * this; Phase 19 ships the method but the route is stubbed.
   */
  static async updateConfig(
    update: Partial<Omit<IEnergyConfig, 'id' | 'updatedAt'>>,
  ): Promise<IEnergyConfig> {
    await db.execute(sql`
      UPDATE energy_config
      SET
        customer_name    = COALESCE(${update.customerName ?? null}, customer_name),
        machine_serial   = COALESCE(${update.machineSerial ?? null}, machine_serial),
        machine_model    = COALESCE(${update.machineModel ?? null}, machine_model),
        install_site     = COALESCE(${update.installSite ?? null}, install_site),
        cosphi           = COALESCE(${update.cosphi ?? null}, cosphi),
        shift_start_hour = COALESCE(${update.shiftStartHour ?? null}, shift_start_hour),
        updated_at       = NOW()
      WHERE id = 1
    `);
    return EnergyConfigService.getConfig();
  }

  /**
   * Return the period row whose `[valid_from, valid_to)` half-open interval
   * contains the `at` timestamp. If `valid_to IS NULL` the period is
   * open-ended (current period). Throws if no matching period exists — the
   * table must always have at least one seeded row covering the target
   * instant, which `ensureTable()` guarantees on first boot (ECFG-02).
   *
   * Half-open semantics: at == valid_from belongs to the NEW period; at ==
   * valid_to belongs to the NEXT period. This matters at year boundaries
   * where two periods share an instant.
   *
   * This method is pure in the sense that (at, DB state) maps to a unique
   * row. Two calls with the same `at` against an unchanged DB produce
   * byte-identical output — that is the ECFG-03/04 reproducibility contract
   * that Plan 19-10's aggregate service relies on to freeze cost/CO₂ at
   * aggregation time.
   */
  static async getActivePeriod(at: Date): Promise<IEnergyConfigPeriod> {
    const result = await db.execute(sql`
      SELECT
        id,
        valid_from                 AS "validFrom",
        valid_to                   AS "validTo",
        emission_factor_kg_per_kwh AS "emissionFactorKgPerKwh",
        emission_factor_year       AS "emissionFactorYear",
        emission_factor_source     AS "emissionFactorSource",
        tariff_mode                AS "tariffMode",
        tariff_single_eur_per_kwh  AS "tariffSingleEurPerKwh",
        tariff_bands_json          AS "tariffBandsJson",
        custom_holidays            AS "customHolidays",
        created_at                 AS "createdAt"
      FROM energy_config_periods
      WHERE valid_from <= ${at}::timestamptz
        AND (valid_to IS NULL OR valid_to > ${at}::timestamptz)
      ORDER BY valid_from DESC
      LIMIT 1
    `);
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `No energy_config_periods row covers timestamp ${at.toISOString()} — run ensureTable() first or insert a seed row`,
      );
    }
    // The `tariff_single_eur_per_kwh` column is `REAL` in Postgres and the
    // pg driver may return it as a string on some driver versions; coerce
    // defensively so downstream numeric math does not silently concat.
    const normalized = row as unknown as IEnergyConfigPeriod & {
      validFrom: string | Date;
      validTo: string | Date | null;
      createdAt: string | Date;
      tariffSingleEurPerKwh: number | string;
      emissionFactorKgPerKwh: number | string;
    };
    return {
      ...normalized,
      validFrom: normalized.validFrom instanceof Date ? normalized.validFrom : new Date(normalized.validFrom),
      validTo: normalized.validTo == null ? null : (normalized.validTo instanceof Date ? normalized.validTo : new Date(normalized.validTo)),
      createdAt: normalized.createdAt instanceof Date ? normalized.createdAt : new Date(normalized.createdAt),
      tariffSingleEurPerKwh: Number(normalized.tariffSingleEurPerKwh),
      emissionFactorKgPerKwh: Number(normalized.emissionFactorKgPerKwh),
    };
  }

  /**
   * Insert a new versioned period. Back-closes the previously-open-ended
   * period by setting its `valid_to` to the new period's `valid_from`.
   * Phase 23 `/settings/energy` is the caller.
   *
   * Wrapped in a BEGIN/COMMIT pair so the UPDATE + INSERT either both
   * succeed or neither does — prevents leaving the table with two
   * open-ended rows on crash between statements.
   */
  static async insertNewPeriod(
    period: Omit<IEnergyConfigPeriod, 'id' | 'createdAt'>,
  ): Promise<void> {
    await db.execute(sql`BEGIN`);
    try {
      await db.execute(sql`
        UPDATE energy_config_periods
        SET valid_to = ${period.validFrom}::timestamptz
        WHERE valid_to IS NULL
          AND valid_from < ${period.validFrom}::timestamptz
      `);
      const bandsJson = JSON.stringify(
        (period.tariffBandsJson ?? {}) as ITariffBands,
      );
      const holidaysJson = JSON.stringify(period.customHolidays ?? []);
      await db.execute(sql`
        INSERT INTO energy_config_periods (
          valid_from, valid_to,
          emission_factor_kg_per_kwh, emission_factor_year, emission_factor_source,
          tariff_mode, tariff_single_eur_per_kwh,
          tariff_bands_json, custom_holidays
        ) VALUES (
          ${period.validFrom}::timestamptz, ${period.validTo ?? null}::timestamptz,
          ${period.emissionFactorKgPerKwh}, ${period.emissionFactorYear}, ${period.emissionFactorSource},
          ${period.tariffMode}, ${period.tariffSingleEurPerKwh},
          ${bandsJson}::jsonb, ${holidaysJson}::jsonb
        )
      `);
      await db.execute(sql`COMMIT`);
    } catch (err) {
      await db.execute(sql`ROLLBACK`);
      throw err;
    }
  }
}
