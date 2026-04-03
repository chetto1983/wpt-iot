import type { FastifyPluginAsync } from 'fastify';
import { UserRole } from '@wpt/types';
import { AuthService } from '../auth/authService.js';
import { requireRole } from '../auth/authHooks.js';

/**
 * User CRUD routes for SuperAdmin.
 * All routes require SUPER_ADMIN role via plugin-level preHandler.
 */
export const userRoutes: FastifyPluginAsync = async (server) => {
  // Plugin-level preHandler: all routes require SUPER_ADMIN
  server.addHook('preHandler', requireRole(UserRole.SUPER_ADMIN));

  /**
   * GET /users
   * List all users (without passwords).
   */
  server.get('/users', async (_request, _reply) => {
    return AuthService.list();
  });

  /**
   * POST /users
   * Create a new user. Returns 409 on duplicate username.
   */
  server.post('/users', async (request, reply) => {
    const body = request.body as {
      username?: string;
      password?: string;
      role?: string;
    };

    if (!body.username || body.username.length < 3) {
      return reply
        .code(400)
        .send({ error: 'Username must be at least 3 characters' });
    }
    if (!body.password || body.password.length < 4) {
      return reply
        .code(400)
        .send({ error: 'Password must be at least 4 characters' });
    }
    if (!body.role) {
      return reply.code(400).send({ error: 'Role is required' });
    }

    try {
      const user = await AuthService.create(body.username, body.password, body.role);
      return reply.code(201).send(user);
    } catch (err: unknown) {
      // Unique constraint violation on username
      if (
        err instanceof Error &&
        (err.message.includes('unique') ||
          err.message.includes('duplicate') ||
          err.message.includes('23505'))
      ) {
        return reply.code(409).send({ error: 'Username already exists' });
      }
      throw err;
    }
  });

  /**
   * PUT /users/:id
   * Update user fields (username, role).
   */
  server.put<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const body = request.body as { username?: string; role?: string };

    const user = await AuthService.update(id, body);
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return user;
  });

  /**
   * PUT /users/:id/password
   * SuperAdmin resets another user's password (per D-15).
   * Does NOT require current password.
   */
  server.put<{ Params: { id: string } }>(
    '/users/:id/password',
    async (request, reply) => {
      const id = Number(request.params.id);
      const body = request.body as { password?: string };

      if (!body.password || body.password.length < 4) {
        return reply
          .code(400)
          .send({ error: 'Password must be at least 4 characters' });
      }

      const ok = await AuthService.changePassword(id, body.password);
      if (!ok) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return { ok: true };
    },
  );

  /**
   * DELETE /users/:id
   * Delete a user. Prevents self-deletion.
   */
  server.delete<{ Params: { id: string } }>(
    '/users/:id',
    async (request, reply) => {
      const id = Number(request.params.id);

      // Prevent self-deletion
      if (id === request.session.userId) {
        return reply.code(400).send({ error: 'Cannot delete your own account' });
      }

      const ok = await AuthService.deleteUser(id);
      if (!ok) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return { ok: true };
    },
  );
};
