import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { UserRole, MqttRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { MqttConfigService } from '../mqtt/configService.js';
import { DynSecClient } from '../mqtt/dynSecClient.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
  role: z.enum([MqttRole.READER, MqttRole.OPERATOR, MqttRole.ADMIN]),
  textName: z.string().max(100).optional(),
});

const modifyUserSchema = z.object({
  password: z.string().min(8).max(100).optional(),
  role: z.enum([MqttRole.READER, MqttRole.OPERATOR, MqttRole.ADMIN]).optional(),
  textName: z.string().max(100).optional(),
});

/**
 * MQTT admin REST routes.
 * All routes require SUPER_ADMIN role.
 * Prefix: /api/mqtt
 */
export const mqttRoutes: FastifyPluginAsync = async (server) => {
  // Plugin-level preHandler: all routes require SUPER_ADMIN
  server.addHook('preHandler', requireRole(UserRole.SUPER_ADMIN));

  // Initialize DynSecClient if MQTT broker is connected
  let dynSecClient: DynSecClient | null = null;

  if (server.mqtt) {
    dynSecClient = new DynSecClient(server.mqtt, server.log);
    await dynSecClient.init();
  }

  // Cleanup on server close
  server.addHook('onClose', async () => {
    if (dynSecClient) {
      dynSecClient.shutdown();
    }
  });

  // ── Config routes ──────────────────────────────────────────────

  /**
   * GET /api/mqtt/config
   * Returns current MQTT gateway configuration.
   */
  server.get('/api/mqtt/config', async (_request, _reply) => {
    return MqttConfigService.getConfig();
  });

  /**
   * PUT /api/mqtt/config
   * Update MQTT gateway configuration. All fields optional.
   */
  server.put('/api/mqtt/config', async (request, reply) => {
    const result = z.object({
      enabled: z.boolean().optional(),
      brokerHost: z.string().min(1).max(255).optional(),
      brokerPort: z.int().min(1).max(65535).optional(),
      siteId: z.string().min(1).max(100).optional(),
      machineId: z.string().min(1).max(100).optional(),
      publishMachine: z.boolean().optional(),
      publishAlarms: z.boolean().optional(),
      publishRfid: z.boolean().optional(),
      publishJobs: z.boolean().optional(),
    }).safeParse(request.body);

    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid config', details: result.error.issues });
    }

    return MqttConfigService.updateConfig(result.data);
  });

  // ── Status route ───────────────────────────────────────────────

  /**
   * GET /api/mqtt/status
   * Returns broker connection state and basic config info.
   */
  server.get('/api/mqtt/status', async (_request, _reply) => {
    const config = await MqttConfigService.getConfig();
    return {
      connected: server.mqtt?.connected ?? false,
      enabled: config.enabled,
      brokerHost: config.brokerHost,
      brokerPort: config.brokerPort,
      clientId: `wpt-backend-${process.pid}`,
    };
  });

  // ── User management routes ─────────────────────────────────────

  /**
   * GET /api/mqtt/users
   * List all MQTT users from Dynamic Security Plugin.
   */
  server.get('/api/mqtt/users', async (_request, reply) => {
    if (!dynSecClient) {
      return reply.code(503).send({ error: 'MQTT not connected' });
    }
    return dynSecClient.listClients();
  });

  /**
   * POST /api/mqtt/users
   * Create a new MQTT user with a role.
   */
  server.post('/api/mqtt/users', async (request, reply) => {
    if (!dynSecClient) {
      return reply.code(503).send({ error: 'MQTT not connected' });
    }

    const result = createUserSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid input', details: result.error.issues });
    }

    const { username, password, role, textName } = result.data;
    try {
      await dynSecClient.createClient(username, password, role, textName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('already exists') || msg.includes('Client already exists')) {
        return reply.code(409).send({ error: 'MQTT user already exists' });
      }
      throw err;
    }
    return reply.code(201).send({ username, role });
  });

  /**
   * PUT /api/mqtt/users/:username
   * Modify an existing MQTT user (password, role, textName).
   */
  server.put<{ Params: { username: string } }>(
    '/api/mqtt/users/:username',
    async (request, reply) => {
      if (!dynSecClient) {
        return reply.code(503).send({ error: 'MQTT not connected' });
      }

      const result = modifyUserSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ error: 'Invalid input', details: result.error.issues });
      }

      const { password, role, textName } = result.data;
      await dynSecClient.modifyClient(request.params.username, {
        password,
        roles: role ? [role] : undefined,
        textName,
      });

      return { username: request.params.username };
    },
  );

  /**
   * DELETE /api/mqtt/users/:username
   * Delete an MQTT user. Cannot delete the system account.
   */
  server.delete<{ Params: { username: string } }>(
    '/api/mqtt/users/:username',
    async (request, reply) => {
      if (!dynSecClient) {
        return reply.code(503).send({ error: 'MQTT not connected' });
      }

      if (request.params.username === 'wpt-backend') {
        return reply.code(400).send({ error: 'Cannot delete system account' });
      }

      try {
        await dynSecClient.deleteClient(request.params.username);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (msg.includes('not found') || msg.includes('Client not found')) {
          return reply.code(404).send({ error: 'MQTT user not found' });
        }
        throw err;
      }
      return reply.code(204).send();
    },
  );

  // ── Connection test route ──────────────────────────────────────

  /**
   * POST /api/mqtt/test
   * Quick broker connection health check.
   */
  server.post('/api/mqtt/test', async (_request, reply) => {
    if (server.mqtt?.connected) {
      return { success: true, message: 'Broker connection active' };
    }
    return reply.code(503).send({ success: false, message: 'Broker not connected' });
  });
};
