import type { FastifyPluginAsync } from 'fastify';
import { LoginRequestSchema } from '@wpt/types';
import { AuthService } from '../auth/authService.js';
import { requireAuth } from '../auth/authHooks.js';

/**
 * Auth routes: login, logout, me, change-password.
 * Registered without prefix — routes already include /auth/.
 */
export const authRoutes: FastifyPluginAsync = async (server) => {
  /**
   * POST /auth/login
   * Validate credentials, set session, return user (without password).
   */
  server.post('/auth/login', async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }

    const { username, password, language } = parsed.data;
    const user = await AuthService.login(username, password);
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Set session fields
    request.session.userId = user.id;
    request.session.username = user.username;
    request.session.role = user.role;
    request.session.language = language ?? 'it';

    // Explicit field selection — no password field leakage
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      avatar: user.avatar ?? null,
      language: request.session.language,
    };
  });

  /**
   * POST /auth/logout
   * Destroy session row from PostgreSQL (per D-05).
   */
  server.post('/auth/logout', async (request, _reply) => {
    await request.session.destroy();
    return { ok: true };
  });

  /**
   * GET /auth/me
   * Return current user from session with role re-read from DB.
   */
  server.get('/auth/me', async (request, reply) => {
    if (!request.session.userId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await AuthService.getById(request.session.userId);
    if (!user) {
      await request.session.destroy();
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      avatar: user.avatar ?? null,
      language: request.session.language ?? 'it',
    };
  });

  /**
   * POST /auth/change-password
   * Any authenticated user can change their own password (per D-15).
   * Requires current password verification.
   */
  server.post(
    '/auth/change-password',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!body.currentPassword || !body.newPassword) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      if (body.newPassword.length < 4) {
        return reply
          .code(400)
          .send({ error: 'New password must be at least 4 characters' });
      }

      const valid = await AuthService.verifyPassword(
        request.session.userId,
        body.currentPassword,
      );
      if (!valid) {
        return reply.code(400).send({ error: 'Current password is incorrect' });
      }

      await AuthService.changePassword(request.session.userId, body.newPassword);
      return { ok: true };
    },
  );
};
