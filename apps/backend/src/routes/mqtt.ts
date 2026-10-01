import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { UserRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { MqttConfigService } from '../mqtt/configService.js';
import { getEvents } from '../mqtt/activityLog.js';
import { SparkplugService } from '../mqtt/sparkplugService.js';
import { ALARM_CATALOG_VERSION } from '../mqtt/alarmCatalogVersion.js';

/**
 * Sparkplug B 3.0 group_id / edge_node_id slug.
 * Hard requirements (Sparkplug §5 + MQTT 3.1.1 topic rules): no slashes
 * (would split the topic path), no `+` / `#` (MQTT wildcards), no Unicode
 * (breaks UTF-8 round-trips in downstream SCADA hosts). Must start and end
 * with an alphanumeric so `foo-` / `-foo` / `--` are rejected.
 *
 * Case is left mixed for backward compatibility with the shipped default
 * (`WPT`). The topic-namespace.md recommendation of all-lower-case is a
 * style preference, not a wire-contract constraint.
 */
const SLUG_REGEX = /^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/;
const SLUG_MESSAGE =
  'must be ASCII alphanumerics, hyphens, or underscores; no slashes, wildcards, or Unicode (Sparkplug B topic-namespace rule)';

const configUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  brokerHost: z.string().min(1).max(255).optional(),
  brokerPort: z.int().min(1).max(65535).optional(),
  username: z.string().min(1).max(255).optional(),
  // Allow empty string to mean "no change". Non-empty must be 1..255 chars.
  password: z.string().max(255).optional(),
  useTls: z.boolean().optional(),
  caCert: z.string().max(10000).nullable().optional(),
  sparkplugGroupId: z.string().min(1).max(64).regex(SLUG_REGEX, SLUG_MESSAGE).optional(),
  sparkplugEdgeNodeId: z.string().min(1).max(64).regex(SLUG_REGEX, SLUG_MESSAGE).optional(),
  publishCycleRecords: z.boolean().optional(),
  telemetryIntervalSeconds: z.int().min(5).max(3600).optional(),
}).strict();

/**
 * MQTT admin REST routes for the Sparkplug B uplink — the edge's only MQTT
 * connection. The edge publishes and never subscribes: there is no command
 * path from MQTT to the PLC and no on-box broker to administer.
 * All routes require SUPER_ADMIN role. Prefix: /api/mqtt
 */
export const mqttRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireRole(UserRole.SUPER_ADMIN));

  /**
   * GET /api/mqtt/config
   * Current uplink configuration with the broker password redacted. The
   * frontend uses `passwordSet` to decide whether the password input is required.
   */
  server.get('/mqtt/config', async () => {
    return MqttConfigService.getPublicConfig();
  });

  /**
   * PUT /api/mqtt/config
   * Update uplink configuration. All fields optional. An empty-string password
   * is treated as "leave unchanged" so the form can round-trip without forcing
   * the operator to retype credentials.
   */
  server.put('/mqtt/config', async (request, reply) => {
    const result = configUpdateSchema.safeParse(request.body);
    if (!result.success) {
      // .strict() surfaces unknown keys (legacy publish_* toggles, retired
      // siteId/machineId) as `unrecognized_keys` so stale clients fail loudly.
      return reply.code(400).send({ error: 'Invalid config', details: result.error.issues });
    }

    await MqttConfigService.updateConfig(result.data);
    // Tear down and re-init with the fresh DB config. Without this the uplink
    // stays pinned to its previous (possibly null) client until the next
    // restart, and publishCycleRecord silently drops drained cycles (verified
    // 2026-04-20 against sacchi: cycles 1080-1091 marked published while the
    // client was null).
    await SparkplugService.stop();
    await SparkplugService.init(request.log);
    return MqttConfigService.getPublicConfig();
  });

  /**
   * POST /api/mqtt/rebirth
   * Operator-initiated NBIRTH + DBIRTH republish. Resets `seq` to 0 per
   * §6.4.3 MUST. Returns 503 if the uplink is not connected.
   */
  server.post('/mqtt/rebirth', async (_request, reply) => {
    if (!SparkplugService.isConnected()) {
      return reply.code(503).send({ error: 'Sparkplug uplink not connected' });
    }
    try {
      await SparkplugService.requestRebirth();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: msg });
    }
  });

  /**
   * GET /api/mqtt/status
   * Uplink connection state and Sparkplug session info.
   */
  server.get('/mqtt/status', async () => {
    const config = await MqttConfigService.getConfig();
    const spState = SparkplugService.getSessionState();
    return {
      connected: SparkplugService.isConnected(),
      enabled: config.enabled,
      brokerHost: config.brokerHost,
      brokerPort: config.brokerPort,
      sparkplugClientId: spState.clientId,
      sparkplugEdgeNodeId: spState.edgeNodeId,
      bdSeq: spState.bdSeq,
      seq: spState.seq,
      alarmCatalogVersion: ALARM_CATALOG_VERSION,
    };
  });

  /**
   * POST /api/mqtt/test
   * Quick uplink health check.
   */
  server.post('/mqtt/test', async (_request, reply) => {
    if (SparkplugService.isConnected()) {
      return { success: true, message: 'Sparkplug uplink connected' };
    }
    return reply.code(503).send({ success: false, message: 'Sparkplug uplink not connected' });
  });

  /**
   * GET /api/mqtt/log
   * Recent MQTT activity events (ring buffer, last 100).
   */
  server.get('/mqtt/log', async () => {
    return getEvents();
  });
};
