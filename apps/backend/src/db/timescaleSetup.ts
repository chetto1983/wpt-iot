import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

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
