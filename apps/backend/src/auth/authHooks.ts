import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@wpt/types';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authUsers } from '../db/schema/auth.js';

/**
 * Fastify preHandler hook: verify that request has a valid session.
 * Re-reads role from database on every request (per D-03 immediate role sync).
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.session.userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  // D-03: Re-read role from DB on every authenticated request
  const rows = await db
    .select({ id: authUsers.id, role: authUsers.role })
    .from(authUsers)
    .where(eq(authUsers.id, request.session.userId));
  const user = rows[0];

  if (!user) {
    await request.session.destroy();
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  // Update session role with current DB value
  request.session.role = user.role;
}

/**
 * Fastify preHandler factory: verify that session user has one of the allowed roles.
 * Calls requireAuth first, then checks role membership.
 */
export function requireRole(
  ...roles: UserRole[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);

    // If requireAuth already sent a response, stop here
    if (reply.sent) return;

    if (!roles.includes(request.session.role as UserRole)) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  };
}
