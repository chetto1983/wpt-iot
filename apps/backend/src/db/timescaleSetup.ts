import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Invokes the two TimescaleDB setup functions defined by
 * docker/init-timescaledb.sql. Both are idempotent — safe to run on
 * every boot.
 *
 *   setup_timescaledb_retention()
 *     Converts machine_snapshots to a hypertable, creates snapshots_5min
 *     and snapshots_1h continuous aggregates, and installs retention +
 *     compression policies.
 *
 *   setup_energy_aggregates()
 *     Creates the Phase 19 energy_5min / energy_1h / energy_1d / energy_1mo
 *     continuous aggregates and their refresh policies.
 *
 * Without this call, the /api/energy/dashboard, /aggregate, and
 * /reconciliation endpoints return 500 on any deployment where the
 * runbook step "docker compose exec db psql -c 'SELECT setup_energy_aggregates();'"
 * was forgotten. Observed on the 192.168.101.151 VM on 2026-04-14.
 *
 * If the functions are absent (e.g. the DB was restored from a dump that
 * predates docker/init-timescaledb.sql) we log a warning with the runbook
 * pointer but do NOT crash — the rest of the backend can still serve
 * non-energy endpoints.
 */
export async function applyTimescaleSetup(
  pool: Pool,
  logger: FastifyBaseLogger,
): Promise<void> {
  const fns = ['setup_timescaledb_retention', 'setup_energy_aggregates'];

  for (const fn of fns) {
    try {
      logger.info({ name: 'TimescaleSetup', fn }, `Invoking ${fn}()`);
      await pool.query(`SELECT ${fn}();`);
      logger.info({ name: 'TimescaleSetup', fn }, `${fn}() complete`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (message.includes('does not exist') || message.includes('undefined_function')) {
        logger.warn(
          { name: 'TimescaleSetup', fn },
          `${fn}() not defined in DB — run docker/init-timescaledb.sql against this volume, or re-provision.`,
        );
        continue;
      }
      logger.error(
        { name: 'TimescaleSetup', fn, err: message },
        `${fn}() failed`,
      );
      throw err;
    }
  }
}
