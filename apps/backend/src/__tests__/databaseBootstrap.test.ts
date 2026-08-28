import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  applyDatabaseBootstrap,
  databaseMigrationSteps,
  type DatabaseMigrationStep,
} from '../db/databaseBootstrap.js';

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

describe('applyDatabaseBootstrap', () => {
  it('includes every repository-owned migration before Timescale aggregates', () => {
    expect(databaseMigrationSteps.map((step) => step.name)).toEqual([
      'drizzle',
      'mqtt-config',
      'energy-config',
      'energy-attribution',
      'energy-baseline',
      'machine-anomaly-events',
      'plc-config',
      'application-config',
      'machine-schema-v03',
      'timescale-aggregates',
    ]);
  });

  it('runs migration steps sequentially in their declared order', async () => {
    const completed: string[] = [];
    const steps: DatabaseMigrationStep[] = ['schema', 'runtime', 'aggregates'].map((name) => ({
      name,
      run: vi.fn(async () => { completed.push(name); }),
    }));

    await applyDatabaseBootstrap(makeLogger(), steps);

    expect(completed).toEqual(['schema', 'runtime', 'aggregates']);
  });

  it('stops before aggregates when an earlier migration fails', async () => {
    const aggregates = vi.fn();
    const steps: DatabaseMigrationStep[] = [
      { name: 'schema', run: vi.fn(async () => undefined) },
      { name: 'runtime', run: vi.fn(async () => { throw new Error('migration failed'); }) },
      { name: 'aggregates', run: aggregates },
    ];

    await expect(applyDatabaseBootstrap(makeLogger(), steps)).rejects.toThrow('migration failed');
    expect(aggregates).not.toHaveBeenCalled();
  });
});
