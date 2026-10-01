import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { withFreshSession } from './index.js';

const timescaleBootstrapUrl = new URL(
  '../../../../docker/init-timescaledb.sql',
  import.meta.url,
);

interface AggregateBackfillState {
  refresh_from: Date | null;
  refresh_to: Date | null;
  requires_backfill: boolean;
}

/**
 * Brings the installed TimescaleDB extension up to the version the db image
 * ships. The image bundles every prior version's library, so after an image
 * bump the database keeps running the old version until this ALTER runs
 * (measured 2026-10-01: 2.30.2 image, database stayed on 2.26.3).
 *
 * Timescale requires the ALTER as the first command of a fresh session: any
 * earlier statement makes the loader pull in the old library. Hence a
 * dedicated session, run before anything touches the pool.
 * https://www.tigerdata.com/docs/self-hosted/latest/upgrades/minor-upgrade
 *
 * A failure is logged, not thrown: the installed version keeps serving machine
 * data, whereas aborting boot would stop it on every restart.
 */
export async function updateTimescaleExtension(
  logger: FastifyBaseLogger,
  database: string = config.pgDb,
): Promise<void> {
  try {
    const version = await withFreshSession(database, async (client) => {
      await client.query('ALTER EXTENSION timescaledb UPDATE');
      const result = await client.query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'",
      );
      return result.rows[0]?.extversion;
    });
    logger.info(
      { name: 'TimescaleSetup', database, version },
      'TimescaleDB extension is up to date',
    );
  } catch (err) {
    logger.error(
      { name: 'TimescaleSetup', database, err },
      'TimescaleDB extension update failed; continuing on the installed version',
    );
  }
}

/**
 * Installs the TimescaleDB setup SQL bundled in the backend image, then invokes
 * both setup functions. Every operation is idempotent and safe on each boot.
 *
 * Bundling and applying the SQL here is essential for existing edge volumes:
 * docker-entrypoint-initdb.d only runs when PostgreSQL creates a brand-new
 * volume, while the edge updater replaces application images in place.
 */
export async function applyTimescaleSetup(
  pool: Pool,
  logger: FastifyBaseLogger,
): Promise<void> {
  logger.info(
    { name: 'TimescaleSetup' },
    'Installing bundled TimescaleDB runtime SQL',
  );
  const bootstrapSql = await readFile(timescaleBootstrapUrl, 'utf8');
  await pool.query(bootstrapSql);
  logger.info(
    { name: 'TimescaleSetup' },
    'Bundled TimescaleDB runtime SQL installed',
  );

  const fns = ['setup_timescaledb_retention', 'setup_energy_aggregates'];

  for (const fn of fns) {
    try {
      logger.info({ name: 'TimescaleSetup', fn }, `Invoking ${fn}()`);
      await pool.query(`SELECT ${fn}();`);
      logger.info({ name: 'TimescaleSetup', fn }, `${fn}() complete`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      logger.error(
        { name: 'TimescaleSetup', fn, err: message },
        `${fn}() failed`,
      );
      throw err;
    }
  }

  const backfillResult = await pool.query<AggregateBackfillState>(`
    WITH raw_bounds AS (
      SELECT
        date_trunc(
          'month',
          GREATEST(MIN("timestamp"), MAX("timestamp") - INTERVAL '30 days'),
          'Europe/Rome'
        ) - INTERVAL '1 month' AS refresh_from,
        date_trunc('month', MAX("timestamp"), 'Europe/Rome') + INTERVAL '2 months' AS refresh_to,
        COUNT(*) > 0 AS has_raw_data
      FROM machine_snapshots
    ), aggregate_state AS (
      SELECT
        EXISTS (SELECT 1 FROM snapshots_5min LIMIT 1) AS has_snapshots_5min,
        EXISTS (SELECT 1 FROM snapshots_1h LIMIT 1) AS has_snapshots_1h,
        EXISTS (SELECT 1 FROM snapshots_1d LIMIT 1) AS has_snapshots_1d,
        EXISTS (SELECT 1 FROM energy_5min LIMIT 1) AS has_5min,
        EXISTS (SELECT 1 FROM energy_1h LIMIT 1) AS has_1h,
        EXISTS (SELECT 1 FROM energy_1d LIMIT 1) AS has_1d,
        EXISTS (SELECT 1 FROM energy_1mo LIMIT 1) AS has_1mo
    )
    SELECT
      raw_bounds.refresh_from,
      raw_bounds.refresh_to,
      (
        raw_bounds.has_raw_data
        AND NOT (
          aggregate_state.has_snapshots_5min
          AND aggregate_state.has_snapshots_1h
          AND aggregate_state.has_snapshots_1d
          AND
          aggregate_state.has_5min
          AND aggregate_state.has_1h
          AND aggregate_state.has_1d
          AND aggregate_state.has_1mo
        )
      ) AS requires_backfill
    FROM raw_bounds
    CROSS JOIN aggregate_state
  `);
  const backfill = backfillResult.rows[0];

  if (
    backfill?.requires_backfill
    && backfill.refresh_from
    && backfill.refresh_to
  ) {
    logger.info(
      {
        name: 'TimescaleSetup',
        refreshFrom: backfill.refresh_from,
        refreshTo: backfill.refresh_to,
      },
      'Backfilling missing continuous aggregates',
    );

    for (const view of [
      'snapshots_5min',
      'snapshots_1h',
      'snapshots_1d',
      'energy_5min',
      'energy_1h',
      'energy_1d',
      'energy_1mo',
    ]) {
      await pool.query(
        `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, $2::timestamptz);`,
        [backfill.refresh_from, backfill.refresh_to],
      );
    }

    logger.info(
      { name: 'TimescaleSetup' },
      'Continuous aggregate backfill complete',
    );
  }

  const verification = await pool.query<{ installed_views: number }>(`
    WITH expected_views(view_name) AS (
      VALUES
        ('snapshots_5min'), ('snapshots_1h'), ('snapshots_1d'),
        ('energy_5min'), ('energy_1h'), ('energy_1d'), ('energy_1mo')
    )
    SELECT COUNT(*)::integer AS installed_views
    FROM expected_views
    INNER JOIN timescaledb_information.continuous_aggregates
      USING (view_name)
  `);
  const installedViews = verification.rows[0]?.installed_views ?? 0;
  if (installedViews !== 7) {
    throw new Error(
      `Timescale setup incomplete: expected 7 continuous aggregates, found ${installedViews}`,
    );
  }
}
