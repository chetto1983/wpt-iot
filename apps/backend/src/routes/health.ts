import type { FastifyPluginAsync } from 'fastify';
import { latestState } from '../cache/latestState.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { getCurrentPlcEndian } from '../udp/parsers.js';

/**
 * Extended health endpoint reporting DB connection + UDP pipeline status (D-13).
 * Returns 'degraded' if DB is unreachable or no machine data in 30 seconds.
 */
export const healthRoute: FastifyPluginAsync = async (server) => {
  server.get('/health', async (_request, _reply) => {
    // Check DB connection
    let dbOk: boolean;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const lastMachineTs = latestState.getLastMachineTimestamp();
    const lastAlarmTs = latestState.getLastAlarmTimestamp();
    const now = Date.now();
    const machineDataStale = lastMachineTs
      ? (now - lastMachineTs.getTime()) > 30_000
      : true; // No data received yet = stale

    return {
      status: dbOk && !machineDataStale ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      db: dbOk ? 'connected' : 'disconnected',
      lastMachineData: lastMachineTs?.toISOString() ?? null,
      lastAlarmPacket: lastAlarmTs?.toISOString() ?? null,
      machineDataStale,
      plcEndian: getCurrentPlcEndian(),
    };
  });
};
