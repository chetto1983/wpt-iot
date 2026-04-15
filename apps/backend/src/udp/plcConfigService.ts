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

/**
 * Thrown by getCachedPlcConfig when the PLC target host cannot be resolved.
 *
 * reason='NOT_CONFIGURED' — targetHost is NULL in the DB (fresh deployment,
 *   operator has not saved the PLC address yet).
 * reason='DB_UNREACHABLE' — the DB read threw an error.
 *
 * Callers (HandshakeFSM, routes) must not catch this silently — it must
 * propagate as a 503 to the operator so the misconfiguration is visible.
 */
export class PlcConfigUnavailableError extends Error {
  readonly code = 'PLC_CONFIG_UNAVAILABLE' as const;
  constructor(readonly reason: 'NOT_CONFIGURED' | 'DB_UNREACHABLE', cause?: unknown) {
    super(reason === 'NOT_CONFIGURED'
      ? 'PLC target host not configured — set it in /plc settings'
      : 'PLC config unavailable — DB read failed');
    this.name = 'PlcConfigUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}

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
   * Fresh deployments insert NULL for target_host — no 'localhost' sentinel.
   */
  static async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS plc_config (
        id SERIAL PRIMARY KEY,
        target_host VARCHAR(255),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await db.execute(
      sql`SELECT id FROM plc_config WHERE id = 1`,
    );

    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO plc_config (id, target_host) VALUES (1, NULL)
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
 * handshake FSM on every send.
 *
 * Throws PlcConfigUnavailableError('NOT_CONFIGURED') when targetHost is NULL
 * (fresh deployment — operator must save the PLC address via /plc settings).
 *
 * Throws PlcConfigUnavailableError('DB_UNREACHABLE') when the DB read fails.
 *
 * There is NO silent fallback to 'localhost'. A misconfigured backend fails
 * loudly with a typed error, not by looping packets back to itself.
 */
export async function getCachedPlcConfig(): Promise<CachedPlcConfig> {
  const now = Date.now();
  if (cachedConfig && now < configCacheExpiry) {
    return cachedConfig;
  }
  try {
    const cfg = await PlcConfigService.getConfig();
    if (!cfg.targetHost) {
      throw new PlcConfigUnavailableError('NOT_CONFIGURED');
    }
    cachedConfig = { targetHost: cfg.targetHost };
    configCacheExpiry = now + CACHE_TTL_MS;
    return cachedConfig;
  } catch (err) {
    // Re-throw PlcConfigUnavailableError (NOT_CONFIGURED path) unchanged.
    if (err instanceof PlcConfigUnavailableError) throw err;
    // DB read threw an unexpected error — wrap and re-throw.
    logger?.warn(
      { name: 'PlcConfigService', err: (err as Error).message },
      'Failed to read plc_config from DB',
    );
    throw new PlcConfigUnavailableError('DB_UNREACHABLE', err);
  }
}

/** Force-refresh the cached config on next read. Called from PUT /api/plc/config. */
function invalidatePlcConfigCache(): void {
  cachedConfig = null;
  configCacheExpiry = 0;
}
