import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pool, withFreshSession } from '../db/index.js';
import { updateTimescaleExtension } from '../db/timescaleSetup.js';

// The versions the fleet runs today: offline bundles shipped 2.25.2, online
// installs 2.26.3. The db image bundles every prior version's library, so a
// scratch database can be created on either and upgraded like a real box.
const FLEET_VERSIONS = ['2.25.2', '2.26.3'];

const scratchDatabases: string[] = [];

function makeLogger(): FastifyBaseLogger {
  return { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
}

async function createScratchDatabase(extensionVersion: string): Promise<string> {
  const database = `wpt_ts_upgrade_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  // template0: the image pre-installs timescaledb in template1.
  await pool.query(`CREATE DATABASE ${database} TEMPLATE template0`);
  scratchDatabases.push(database);
  await withFreshSession(database, (client) =>
    client.query(`CREATE EXTENSION timescaledb VERSION '${extensionVersion}'`));
  return database;
}

function installedVersion(database: string): Promise<string | undefined> {
  return withFreshSession(database, async (client) => {
    const result = await client.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'",
    );
    return result.rows[0]?.extversion;
  });
}

async function shippedVersion(): Promise<string | undefined> {
  const result = await pool.query<{ default_version: string }>(
    "SELECT default_version FROM pg_available_extensions WHERE name = 'timescaledb'",
  );
  return result.rows[0]?.default_version;
}

afterAll(async () => {
  for (const database of scratchDatabases) {
    await pool.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  }
  await pool.end();
});

describe('updateTimescaleExtension', () => {
  it.each(FLEET_VERSIONS)('upgrades a database on %s to the version the db image ships', async (version) => {
    const database = await createScratchDatabase(version);
    expect(await installedVersion(database)).toBe(version);

    await updateTimescaleExtension(makeLogger(), database);

    expect(await installedVersion(database)).toBe(await shippedVersion());
  });

  it('is a no-op on a database already on the shipped version', async () => {
    const database = await createScratchDatabase(FLEET_VERSIONS[1] as string);
    await updateTimescaleExtension(makeLogger(), database);
    const logger = makeLogger();

    await updateTimescaleExtension(logger, database);

    expect(await installedVersion(database)).toBe(await shippedVersion());
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and resolves instead of aborting boot when the update cannot run', async () => {
    const logger = makeLogger();

    await expect(updateTimescaleExtension(logger, 'wpt_ts_upgrade_missing_db')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledOnce();
  });
});
