import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { isValidTimezone, UserRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { ApplicationConfigService } from '../services/applicationConfigService.js';

const updateApplicationConfigSchema = z.object({
  timezone: z
    .string()
    .min(1)
    .max(100)
    .refine(isValidTimezone, 'Invalid IANA timezone'),
});

export const applicationConfigRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireRole(UserRole.SUPER_ADMIN));

  server.get('/application/config', async () =>
    ApplicationConfigService.getConfig(),
  );

  server.put('/application/config', async (request, reply) => {
    const parsed = updateApplicationConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid application configuration',
        details: parsed.error.issues,
      });
    }
    return ApplicationConfigService.updateConfig(parsed.data.timezone);
  });
};

