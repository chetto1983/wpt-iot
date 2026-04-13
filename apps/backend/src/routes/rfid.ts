import type { FastifyPluginAsync } from 'fastify';
import { UserRole, RfidUserSchema } from '@wpt/types';
import type { IRfidUser } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { writeUsers } from '../udp/handshakeFsm.js';
import { getSockets } from '../udp/sockets.js';
import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { rfidUsers } from '../db/schema/users.js';
import { z } from 'zod/v4';

function buildMirroredUsers(rows: Array<{ tagId: number; name: string; group: number; enabled: boolean }>): IRfidUser[] {
  const byTagId = new Map(rows.map((row) => [row.tagId, row]));

  return Array.from({ length: 48 }, (_, index) => {
    const tagId = index + 1;
    const row = byTagId.get(tagId);

    return {
      tagId,
      name: row?.name ?? '',
      group: row?.group ?? 0,
      enabled: row?.enabled ?? false,
    };
  });
}

/**
 * RFID user management routes (read/write PLC user tags).
 * All routes require WPT or SUPER_ADMIN role.
 */
export const rfidRoutes: FastifyPluginAsync = async (server) => {
  // Plugin-level preHandler: WPT + SUPER_ADMIN only
  server.addHook('preHandler', requireRole(UserRole.WPT, UserRole.SUPER_ADMIN));

  /**
   * POST /rfid/read
   * Return the mirrored 48 RFID users from PostgreSQL.
   *
   * This intentionally matches `/jobs/read`: the backend serves its persisted
   * operator snapshot instead of forcing a fresh PLC handshake on every read.
   * The live ABB PLC can still reject an immediate 9092 re-read right after a
   * write, while the UI expects the just-written data to remain readable.
   */
  server.post('/rfid/read', async (_request, _reply) => {
    const rows = await db.select().from(rfidUsers);
    const users = buildMirroredUsers(rows).map((user) => ({
      ...user,
      group: user.group as IRfidUser['group'],
    }));
    return { users };
  });

  /**
   * POST /rfid/write
   * Validate 48 users via Zod, trigger handshake write on port 9092.
   * Emits to dataHub for persistence after successful write.
   */
  server.post('/rfid/write', async (request, reply) => {
    const body = request.body as { users?: unknown };
    const parsed = z.array(RfidUserSchema).length(48).safeParse(body?.users);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid user data',
        details: parsed.error.message,
      });
    }

    try {
      const { ackSocket, userSocket } = getSockets();
      await writeUsers(ackSocket, userSocket, parsed.data as IRfidUser[], request.log);
      dataHub.emitUserData(parsed.data as IRfidUser[]);
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Handshake in progress')) {
        return reply.code(409).send({ error: 'Handshake in progress' });
      }
      throw err;
    }
  });
};
