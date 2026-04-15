import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { UserRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { PlcConfigService } from '../udp/plcConfigService.js';
import { getSockets } from '../udp/sockets.js';
import { readUsers } from '../udp/handshakeFsm.js';

/**
 * PLC configuration REST routes.
 * All routes require SUPER_ADMIN role.
 * Prefix: /api/plc
 *
 * The `target_host` field is the network address of the ABB AC500 PLC (or
 * CODESYS V2.3 simulator). Changing it immediately affects handshake
 * operations — the next /jobs or /rfid read/write will use the new host
 * via the 30-second-TTL cache, which is invalidated on every PUT.
 */
export const plcConfigRoutes: FastifyPluginAsync = async (server) => {
  // All routes require SUPER_ADMIN
  server.addHook('preHandler', requireRole(UserRole.SUPER_ADMIN));

  /**
   * GET /api/plc/config
   * Returns the current PLC target host.
   */
  server.get('/plc/config', async (_request, _reply) => {
    return PlcConfigService.getConfig();
  });

  /**
   * PUT /api/plc/config
   * Update the PLC target host. Invalidates the FSM's cached target so
   * the change takes effect on the next handshake operation.
   */
  server.put('/plc/config', async (request, reply) => {
    const result = z.object({
      targetHost: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[a-zA-Z0-9._-]+$/, 'Must be a valid IP or hostname')
        .refine(v => v !== 'localhost', { message: 'Use the real PLC address, not "localhost"' })
        .optional(),
    }).safeParse(request.body);

    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid config', details: result.error.issues });
    }

    return PlcConfigService.updateConfig(result.data);
  });

  /**
   * POST /api/plc/test-connection
   * Run one non-destructive RFID read handshake to verify PLC reachability.
   * Returns { ok: true, durationMs } on success.
   * Returns { ok: false, durationMs, error } on any error (HTTP 200 in both cases — error
   * is expected-path, not an HTTP failure).
   * Does NOT emit to dataHub — test reads must not overwrite live RFID state.
   */
  server.post('/plc/test-connection', async (_request, reply) => {
    const start = Date.now();
    try {
      const { ackSocket, userSocket } = getSockets();
      await readUsers(ackSocket, userSocket, _request.log);
      return reply.send({ ok: true, durationMs: Date.now() - start });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return reply.send({ ok: false, durationMs: Date.now() - start, error: msg });
    }
  });
};
