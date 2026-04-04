import path from 'node:path';
import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import sharp from 'sharp';
import { AuthService } from '../auth/authService.js';
import { requireAuth } from '../auth/authHooks.js';

/**
 * Avatar upload/delete routes.
 * Any authenticated user can change their own avatar; SUPER_ADMIN can change any user's.
 */
export const avatarRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireAuth);

  /**
   * POST /users/:id/avatar
   * Upload a photo, resize to 200x200 JPEG, save to disk, update DB.
   */
  server.post<{ Params: { id: string } }>(
    '/users/:id/avatar',
    async (request, reply) => {
      const id = Number(request.params.id);

      // Authorization: own user or SUPER_ADMIN
      if (request.session.userId !== id && request.session.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
        return reply.code(400).send({ error: 'Only JPEG and PNG images are allowed' });
      }

      const buffer = await file.toBuffer();
      const outputPath = path.join(process.cwd(), 'uploads', 'avatars', `${id}.jpg`);

      await sharp(buffer)
        .resize(200, 200)
        .jpeg({ quality: 80 })
        .toFile(outputPath);

      const avatarUrl = `/uploads/avatars/${id}.jpg`;
      const user = await AuthService.updateAvatar(id, avatarUrl);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        avatar: `${user.avatar}?t=${Date.now()}`,
        createdAt: user.createdAt,
      };
    },
  );

  /**
   * DELETE /users/:id/avatar
   * Remove avatar file from disk and null the DB column.
   */
  server.delete<{ Params: { id: string } }>(
    '/users/:id/avatar',
    async (request, reply) => {
      const id = Number(request.params.id);

      // Authorization: own user or SUPER_ADMIN
      if (request.session.userId !== id && request.session.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const filePath = path.join(process.cwd(), 'uploads', 'avatars', `${id}.jpg`);
      try {
        fs.unlinkSync(filePath);
      } catch (err: unknown) {
        // Ignore ENOENT — file may not exist
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }

      const user = await AuthService.updateAvatar(id, null);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return {
        id: user.id,
        username: user.username,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.createdAt,
      };
    },
  );
};
