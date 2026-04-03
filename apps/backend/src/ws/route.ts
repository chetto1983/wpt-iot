import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@wpt/types';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authUsers } from '../db/schema/auth.js';
import { addClient, removeClient } from './broadcaster.js';

/**
 * WebSocket route /ws with session-based authentication.
 * Push-only in Phase 6: clients receive MACHINE_DATA and ALARM_UPDATE events.
 * Phase 8+ will add bidirectional message handling (READ_USERS, WRITE_USERS, etc.).
 */
export async function wsRoute(server: FastifyInstance): Promise<void> {
  server.get('/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      // Validate session exists (mirrors requireAuth pattern)
      if (!request.session.userId) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      // D-04: Read role once at connect time, cache on request
      const rows = await db
        .select({ role: authUsers.role })
        .from(authUsers)
        .where(eq(authUsers.id, request.session.userId));
      const user = rows[0];

      if (!user) {
        await request.session.destroy();
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      // Store role on session for use in handler
      request.session.role = user.role;
    },
  }, (socket, request) => {
    // D-04: Role cached at connect time
    const role = request.session.role as UserRole;
    // Session ID available via @fastify/session getter
    const sessionId = request.session.sessionId as string;

    // Attach event handlers synchronously per Pitfall 1
    socket.on('close', () => {
      removeClient(socket);
    });

    socket.on('error', () => {
      removeClient(socket);
      socket.terminate();
    });

    // Phase 6: push-only. Log unexpected client messages (extensibility for Phase 8+).
    socket.on('message', (raw) => {
      request.log.warn(
        { name: 'WsRoute', data: raw.toString().substring(0, 100) },
        'Unexpected client message on push-only WebSocket',
      );
    });

    // Add client to broadcaster (triggers initial push per D-01, D-02)
    addClient(socket, role, sessionId);
  });
}
