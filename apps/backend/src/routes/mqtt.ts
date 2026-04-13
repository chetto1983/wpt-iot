import type { FastifyPluginAsync, FastifyBaseLogger } from 'fastify';
import type { MqttClient } from 'mqtt';
import { z } from 'zod/v4';
import { UserRole, MqttRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { MqttConfigService } from '../mqtt/configService.js';
import { DynSecClient } from '../mqtt/dynSecClient.js';
import { getEvents } from '../mqtt/activityLog.js';
import { getMqttClient, reloadMqttConnection } from '../mqtt/connectionManager.js';

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

  // Lazy-init DynSecClient: the broker connection is set up after server.listen()
  // and may be torn down + rebuilt by `reloadMqttConnection`. Each call rebinds
  // the DynSecClient to the live MQTT client if it has changed.
  let dynSecClient: DynSecClient | null = null;
  let dynSecBoundClient: MqttClient | null = null;

  async function ensureDynSec(log: FastifyBaseLogger): Promise<DynSecClient | null> {
    const live = getMqttClient();
    if (!live) {
      // Connection gone — discard any stale DynSecClient.
      if (dynSecClient && dynSecBoundClient) {
        try { dynSecClient.shutdown(); } catch { /* best effort */ }
      }
      dynSecClient = null;
      dynSecBoundClient = null;
      return null;
    }
    if (dynSecBoundClient !== live) {
      if (dynSecClient) {
        try { dynSecClient.shutdown(); } catch { /* best effort */ }
      }
      dynSecClient = new DynSecClient(live, log);
      await dynSecClient.init();
      dynSecBoundClient = live;
    }
    return dynSecClient;
  }

  // Cleanup on server close
  server.addHook('onClose', async () => {
    if (dynSecClient) {
      try { dynSecClient.shutdown(); } catch { /* best effort */ }
      dynSecClient = null;
      dynSecBoundClient = null;
    }
  });

  // ── Config routes ──────────────────────────────────────────────

  /**
   * GET /api/mqtt/config
   * Returns current MQTT gateway configuration with the broker password
   * redacted. The frontend uses `passwordSet` to decide whether the password
   * input is required.
   */
  server.get('/mqtt/config', async (_request, _reply) => {
    return MqttConfigService.getPublicConfig();
  });

  /**
   * PUT /api/mqtt/config
   * Update MQTT gateway configuration. All fields optional.
   * An empty-string password is treated as "leave unchanged" so the form can
   * round-trip without forcing the operator to retype credentials.
   */
  server.put('/mqtt/config', async (request, reply) => {
    const result = z.object({
      enabled: z.boolean().optional(),
      brokerHost: z.string().min(1).max(255).optional(),
      brokerPort: z.int().min(1).max(65535).optional(),
      username: z.string().min(1).max(255).optional(),
      // Allow empty string to mean "no change". Non-empty must be 1..255 chars.
      password: z.string().max(255).optional(),
      siteId: z.string().min(1).max(100).optional(),
      machineId: z.string().min(1).max(100).optional(),
      publishMachine: z.boolean().optional(),
      publishAlarms: z.boolean().optional(),
      publishRfid: z.boolean().optional(),
      publishJobs: z.boolean().optional(),
      useTls: z.boolean().optional(),
      caCert: z.string().max(10000).nullable().optional(),
    }).safeParse(request.body);

    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid config', details: result.error.issues });
    }

    await MqttConfigService.updateConfig(result.data);
    // Reload the MQTT connection so the new broker host/port/credentials/TLS,
    // site/machine identity, LWT topic, and command-handler subscription all
    // take effect immediately. This is a full disconnect → reconnect cycle.
    await reloadMqttConnection(request.log);
    // Return the redacted public view (no password leak in the response).
    return MqttConfigService.getPublicConfig();
  });

  // ── Status route ───────────────────────────────────────────────

  /**
   * GET /api/mqtt/status
   * Returns broker connection state and basic config info.
   */
  server.get('/mqtt/status', async (_request, _reply) => {
    const config = await MqttConfigService.getConfig();
    const live = getMqttClient();
    return {
      connected: live?.connected ?? false,
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
  server.get('/mqtt/users', async (request, reply) => {
    const dsc = await ensureDynSec(request.log);
    if (!dsc) {
      return reply.code(503).send({ error: 'MQTT not connected' });
    }
    return dsc.listClients();
  });

  /**
   * POST /api/mqtt/users
   * Create a new MQTT user with a role.
   */
  server.post('/mqtt/users', async (request, reply) => {
    const dsc = await ensureDynSec(request.log);
    if (!dsc) {
      return reply.code(503).send({ error: 'MQTT not connected' });
    }

    const result = createUserSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid input', details: result.error.issues });
    }

    const { username, password, role, textName } = result.data;
    try {
      await dsc.createClient(username, password, role, textName);
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
    '/mqtt/users/:username',
    async (request, reply) => {
      const dsc = await ensureDynSec(request.log);
      if (!dsc) {
        return reply.code(503).send({ error: 'MQTT not connected' });
      }

      const result = modifyUserSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ error: 'Invalid input', details: result.error.issues });
      }

      const { password, role, textName } = result.data;
      await dsc.modifyClient(request.params.username, {
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
    '/mqtt/users/:username',
    async (request, reply) => {
      const dsc = await ensureDynSec(request.log);
      if (!dsc) {
        return reply.code(503).send({ error: 'MQTT not connected' });
      }

      if (request.params.username === 'wpt-backend') {
        return reply.code(400).send({ error: 'Cannot delete system account' });
      }

      try {
        await dsc.deleteClient(request.params.username);
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
  server.post('/mqtt/test', async (_request, reply) => {
    const live = getMqttClient();
    if (live?.connected) {
      return { success: true, message: 'Broker connection active' };
    }
    return reply.code(503).send({ success: false, message: 'Broker not connected' });
  });

  // ── Activity log route ──────────────────────────────────────────

  /**
   * GET /api/mqtt/log
   * Returns recent MQTT activity events (ring buffer, last 100).
   */
  server.get('/mqtt/log', async (_request, _reply) => {
    return getEvents();
  });
};
