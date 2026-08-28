import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { applyTimescaleSetup } from '../db/timescaleSetup.js';

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function sqlText(call: unknown[]): string {
  return String(call[0]);
}

describe('applyTimescaleSetup', () => {
  it('ships the runtime SQL in every backend image and rebuilds when it changes', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
    const workflow = readFileSync(
      new URL('../../../../.github/workflows/build-and-publish.yml', import.meta.url),
      'utf8',
    );
    const updater = readFileSync(
      new URL('../../../../scripts/wpt-image-update.sh', import.meta.url),
      'utf8',
    );
    const updateService = readFileSync(
      new URL('../../../../scripts/wpt-image-update.service', import.meta.url),
      'utf8',
    );

    expect(dockerfile).toContain('COPY docker/init-timescaledb.sql ./docker/init-timescaledb.sql');
    expect(workflow).toContain("- 'docker/init-timescaledb.sql'");
    expect(updater).toContain('WPT_IMAGE_UPDATE_HEALTH_TIMEOUT:-600');
    expect(updater).toContain('Database bootstrap verified: 7 continuous aggregates installed.');
    expect(updater).toContain('docker compose cp backend:/app/docker/init-timescaledb.sql');
    expect(updateService).toContain('TimeoutStartSec=15min');
  });

  it('installs the bundled runtime SQL before invoking Timescale setup functions', async () => {
    const query = vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('continuous_aggregates') && statement.includes('expected_views')) {
        return { rows: [{ installed_views: 7 }] };
      }
      return { rows: [] };
    });

    await applyTimescaleSetup(
      { query } as unknown as Pool,
      makeLogger(),
    );

    const statements = query.mock.calls.map(sqlText);
    expect(statements[0]).toContain('CREATE EXTENSION IF NOT EXISTS timescaledb');
    expect(statements[0]).toContain('CREATE OR REPLACE FUNCTION setup_energy_aggregates()');
    expect(statements).toContain('SELECT setup_timescaledb_retention();');
    expect(statements).toContain('SELECT setup_energy_aggregates();');
    expect(statements.indexOf('SELECT setup_timescaledb_retention();')).toBeGreaterThan(0);
  });

  it('backfills every snapshot and energy hierarchy once when aggregate data is missing', async () => {
    const query = vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('AS requires_backfill')) {
        return {
          rows: [{
            refresh_from: new Date('2026-08-01T00:00:00.000Z'),
            refresh_to: new Date('2026-08-29T00:00:00.000Z'),
            requires_backfill: true,
          }],
        };
      }
      if (statement.includes('continuous_aggregates') && statement.includes('expected_views')) {
        return { rows: [{ installed_views: 7 }] };
      }
      return { rows: [] };
    });

    await applyTimescaleSetup(
      { query } as unknown as Pool,
      makeLogger(),
    );

    const statements = query.mock.calls.map(sqlText);
    const refreshes = statements.filter((statement) => statement.includes('refresh_continuous_aggregate'));
    expect(refreshes).toHaveLength(7);
    expect(refreshes[0]).toContain("'snapshots_5min'");
    expect(refreshes[1]).toContain("'snapshots_1h'");
    expect(refreshes[2]).toContain("'snapshots_1d'");
    expect(refreshes[3]).toContain("'energy_5min'");
    expect(refreshes[4]).toContain("'energy_1h'");
    expect(refreshes[5]).toContain("'energy_1d'");
    expect(refreshes[6]).toContain("'energy_1mo'");
  });

  it('does not repeat the backfill when all aggregate levels already contain data', async () => {
    const query = vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('AS requires_backfill')) {
        return {
          rows: [{
            refresh_from: new Date('2026-08-01T00:00:00.000Z'),
            refresh_to: new Date('2026-08-29T00:00:00.000Z'),
            requires_backfill: false,
          }],
        };
      }
      if (statement.includes('continuous_aggregates') && statement.includes('expected_views')) {
        return { rows: [{ installed_views: 7 }] };
      }
      return { rows: [] };
    });

    await applyTimescaleSetup(
      { query } as unknown as Pool,
      makeLogger(),
    );

    const statements = query.mock.calls.map(sqlText);
    expect(statements.some((statement) => statement.includes('refresh_continuous_aggregate'))).toBe(false);
  });

  it('fails startup if the four energy aggregates are not installed', async () => {
    const query = vi.fn().mockImplementation(async (statement: string) => {
      if (statement.includes('AS requires_backfill')) {
        return { rows: [{ refresh_from: null, refresh_to: null, requires_backfill: false }] };
      }
      if (statement.includes('continuous_aggregates') && statement.includes('expected_views')) {
        return { rows: [{ installed_views: 6 }] };
      }
      return { rows: [] };
    });

    await expect(applyTimescaleSetup(
      { query } as unknown as Pool,
      makeLogger(),
    )).rejects.toThrow('expected 7 continuous aggregates');
  });
});
