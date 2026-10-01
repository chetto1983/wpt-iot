import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@wpt/types';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authUsers } from '../db/schema/auth.js';

// Every early reply is RETURNED, never just sent: @fastify/session saves the
// session in an async onSend hook, so a merely-sent reply is still in flight
// when the hook resolves and Fastify runs the route handler anyway. Returning
// the reply (a thenable that settles on end-of-stream) makes Fastify wait.
// https://fastify.dev/docs/latest/Reference/Hooks/#respond-to-a-request-from-a-hook

/**
 * Fastify preHandler hook: verify that request has a valid session.
 * Re-reads role from database on every request (per D-03 immediate role sync).
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  if (!request.session.userId) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  // D-03: Re-read role from DB on every authenticated request
  const rows = await db
    .select({ id: authUsers.id, role: authUsers.role })
    .from(authUsers)
    .where(eq(authUsers.id, request.session.userId));
  const user = rows[0];

  if (!user) {
    await request.session.destroy();
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  request.session.role = user.role;
  return undefined;
}

/**
 * Fastify preHandler factory: verify that session user has one of the allowed roles.
 * Calls requireAuth first, then checks role membership.
 */
export function requireRole(
  ...roles: UserRole[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return reply;

    if (!roles.includes(request.session.role as UserRole)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    return undefined;
  };
}
