import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/index.js';
import { plcConfig } from '../db/schema/plc.js';
import type { IPlcConfig } from '@wpt/types';

/**
 * PLC target configuration, persisted in the DB and cached in-process for
 * the handshake FSM. This is the "all operator data in DB" pattern that
 * replaced the MQTT env vars, now extended to the PLC target host.
 *
 * Changing the target via `PUT /api/plc/config` invalidates the cache so
 * the next handshake read/write picks up the new host immediately.
 */

interface CachedPlcConfig {
  targetHost: string;
}

// Module-level state
let logger: FastifyBaseLogger | null = null;
let cachedConfig: CachedPlcConfig | null = null;
let configCacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

export function setPlcConfigLogger(log: FastifyBaseLogger): void {
  logger = log;
}

export class PlcConfigService {
  /**
   * Ensure plc_config table exists and has a default row.
   * Called once at startup before any config reads.
   */
  static async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS plc_config (
        id SERIAL PRIMARY KEY,
        target_host VARCHAR(255) NOT NULL DEFAULT 'localhost',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await db.execute(
      sql`SELECT id FROM plc_config WHERE id = 1`,
    );

    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO plc_config (id, target_host) VALUES (1, 'localhost')
      `);
    }
  }

  /** Get the current PLC configuration. */
  static async getConfig(): Promise<IPlcConfig> {
    const rows = await db
      .select()
      .from(plcConfig)
      .where(eq(plcConfig.id, 1));

    const row = rows[0];
    if (!row) {
      await PlcConfigService.ensureTable();
      const retry = await db
        .select()
        .from(plcConfig)
        .where(eq(plcConfig.id, 1));
      const retryRow = retry[0];
      if (!retryRow) {
        throw new Error('Failed to initialize plc_config row');
      }
      return retryRow;
    }

    return row;
  }

  /**
   * Update PLC configuration fields. Only provided fields are updated.
   * `updatedAt` is always refreshed. Invalidates the in-process cache so
   * the handshake FSM picks up the new target on its next read.
   */
  static async updateConfig(
    updates: Partial<Omit<IPlcConfig, 'id' | 'updatedAt'>>,
  ): Promise<IPlcConfig> {
    const rows = await db
      .update(plcConfig)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(plcConfig.id, 1))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('plc_config row not found');
    }

    invalidatePlcConfigCache();
    return row;
  }
}

/**
 * Read the PLC target host from a 30-second TTL cache. Called from the
 * handshake FSM on every send. Falls back to 'localhost' if the DB read
 * fails so the backend doesn't crash — the operator just needs to save
 * the form again once the DB is reachable.
 */
export async function getCachedPlcConfig(): Promise<CachedPlcConfig> {
  const now = Date.now();
  if (cachedConfig && now < configCacheExpiry) {
    return cachedConfig;
  }
  try {
    const cfg = await PlcConfigService.getConfig();
    cachedConfig = { targetHost: cfg.targetHost };
    configCacheExpiry = now + CACHE_TTL_MS;
    return cachedConfig;
  } catch (err) {
    logger?.error(
      { name: 'PlcConfigService', err: (err as Error).message },
      'Failed to read plc_config from DB — falling back to localhost',
    );
    return { targetHost: 'localhost' };
  }
}

/** Force-refresh the cached config on next read. Called from PUT /api/plc/config. */
function invalidatePlcConfigCache(): void {
  cachedConfig = null;
  configCacheExpiry = 0;
}
