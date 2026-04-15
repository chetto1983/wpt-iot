import type { FastifyPluginAsync } from 'fastify';
import { UserRole, RfidUserSchema } from '@wpt/types';
import type { IRfidUser } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { readUsers, writeUsers } from '../udp/handshakeFsm.js';
import { getSockets } from '../udp/sockets.js';
import { dataHub } from '../events/hub.js';
import { mapHandshakeError } from './_util/handshake-errors.js';
import { z } from 'zod/v4';

/**
 * RFID user management routes (read/write PLC user tags).
 * All routes require WPT or SUPER_ADMIN role.
 */
export const rfidRoutes: FastifyPluginAsync = async (server) => {
  // Plugin-level preHandler: WPT + SUPER_ADMIN only
  server.addHook('preHandler', requireRole(UserRole.WPT, UserRole.SUPER_ADMIN));

  /**
   * POST /rfid/read
   * Trigger handshake read on port 9092, return 48 RFID users.
   * Emits to dataHub for persistence via userStore subscriber.
   */
  server.post('/rfid/read', async (request, reply) => {
    try {
      const { ackSocket, userSocket } = getSockets();
      const users = await readUsers(ackSocket, userSocket, request.log);
      dataHub.emitUserData(users);
      return { users };
    } catch (err: unknown) {
      return mapHandshakeError(err, reply);
    }
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
      return mapHandshakeError(err, reply);
    }
  });
};
