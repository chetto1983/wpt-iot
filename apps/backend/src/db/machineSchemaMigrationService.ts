import { sql } from 'drizzle-orm';
import { db } from './index.js';

/**
 * V03 protocol schema migration for machine_snapshots (PROT-V03-04, PROT-V03-05).
 *
 * Idempotent boot-time migration that mirrors the MqttConfigService.ensureTable()
 * pattern — see D:/Wpt/CLAUDE.md hard rule:
 *   "update schema files in apps/backend/src/db/schema/, use db:push only against
 *    local Docker PostgreSQL. If a migration would be destructive (drop column,
 *    drop table), STOP and ASK before proceeding."
 *
 * This migration is NON-DESTRUCTIVE:
 * - RENAME COLUMN preserves data (in v1.0 these were unused spares so data is
 *   meaningless, but the rename is still idempotent via information_schema guards)
 * - ADD COLUMN IF NOT EXISTS is safe to call N times
 *
 * The migration runs at backend boot BEFORE startUdpPipeline() so the UDP parser
 * never attempts to INSERT into a pre-V03 schema. Fails loudly on any DB error —
 * a running backend with a half-migrated schema would write garbage rows.
 */
export class MachineSchemaMigrationService {
  /**
   * Apply the V03 column additions + renames to machine_snapshots.
   * Idempotent. Safe to call on every boot.
   */
  static async ensureV03Columns(): Promise<void> {
    // 1) Rename spare_int_71 -> cycle_status (if still named spare_int_71)
    //    Guarded by information_schema check so the rename runs exactly once.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'machine_snapshots' AND column_name = 'spare_int_71'
        ) THEN
          ALTER TABLE machine_snapshots RENAME COLUMN spare_int_71 TO cycle_status;
        END IF;
      END $$;
    `);

    // 2) Rename spare_int_72 -> container (if still named spare_int_72)
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'machine_snapshots' AND column_name = 'spare_int_72'
        ) THEN
          ALTER TABLE machine_snapshots RENAME COLUMN spare_int_72 TO container;
        END IF;
      END $$;
    `);

    // 3) Add 8 new nullable REAL columns (V03 electrical metering + spare_real_02).
    //    ADD COLUMN IF NOT EXISTS is idempotent — Postgres 9.6+ supports this clause.
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS line_volt_l1_l2 real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS line_volt_l2_l3 real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS line_volt_l3_l1 real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS line_neutral_volt_l1 real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS line_neutral_volt_l2 real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS line_neutral_volt_l3 real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS pf_total real`);
    await db.execute(sql`ALTER TABLE machine_snapshots ADD COLUMN IF NOT EXISTS spare_real_02 real`);

    // 4) Assert post-migration schema (fail loudly if PostgreSQL disagrees).
    const result = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'machine_snapshots'
        AND column_name IN (
          'cycle_status', 'container',
          'line_volt_l1_l2', 'line_volt_l2_l3', 'line_volt_l3_l1',
          'line_neutral_volt_l1', 'line_neutral_volt_l2', 'line_neutral_volt_l3',
          'pf_total', 'spare_real_02',
          'spare_int_71', 'spare_int_72'
        )
    `);
    const presentColumns = new Set<string>(
      (result.rows as Array<{ column_name: string }>).map((r) => r.column_name),
    );

    const requiredPresent = [
      'cycle_status', 'container',
      'line_volt_l1_l2', 'line_volt_l2_l3', 'line_volt_l3_l1',
      'line_neutral_volt_l1', 'line_neutral_volt_l2', 'line_neutral_volt_l3',
      'pf_total', 'spare_real_02',
    ];
    for (const col of requiredPresent) {
      if (!presentColumns.has(col)) {
        throw new Error(
          `MachineSchemaMigrationService: expected column '${col}' on machine_snapshots after migration, not found`,
        );
      }
    }
    const requiredAbsent = ['spare_int_71', 'spare_int_72'];
    for (const col of requiredAbsent) {
      if (presentColumns.has(col)) {
        throw new Error(
          `MachineSchemaMigrationService: column '${col}' still present after migration — rename may have failed`,
        );
      }
    }

    console.log('[MachineSchemaMigrationService] V03 schema verified: cycle_status, container, + 8 new REAL columns present; spare_int_71/72 absent');
  }
}
