import type { FastifyPluginAsync } from 'fastify';
import { UserRole, JobDataSchema } from '@wpt/types';
import type { IJobData } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { readJob, writeJob } from '../udp/handshakeFsm.js';
import { getSockets } from '../udp/sockets.js';
import { dataHub } from '../events/hub.js';

/**
 * Job/commessa management routes (read/write PLC job parameters).
 * All routes require WPT or SUPER_ADMIN role.
 */
export const jobRoutes: FastifyPluginAsync = async (server) => {
  // Plugin-level preHandler: WPT + SUPER_ADMIN only
  server.addHook('preHandler', requireRole(UserRole.WPT, UserRole.SUPER_ADMIN));

  /**
   * POST /jobs/read
   * Trigger handshake read on port 9090, return job data.
   * Emits to dataHub for persistence via jobStore subscriber.
   */
  server.post('/jobs/read', async (request, reply) => {
    try {
      const { ackSocket, dataSocket } = getSockets();
      const job = await readJob(ackSocket, dataSocket, request.log);
      dataHub.emitJobData(job);
      return { job };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Handshake in progress')) {
        return reply.code(409).send({ error: 'Handshake in progress' });
      }
      throw err;
    }
  });

  /**
   * POST /jobs/write
   * Validate job data via Zod, trigger handshake write on port 9090.
   * Emits to dataHub for persistence after successful write.
   */
  server.post('/jobs/write', async (request, reply) => {
    const body = request.body as { job?: unknown };
    const parsed = JobDataSchema.safeParse(body?.job);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid job data',
        details: parsed.error.message,
      });
    }

    try {
      const { ackSocket, dataSocket } = getSockets();
      await writeJob(ackSocket, dataSocket, parsed.data as IJobData, request.log);
      dataHub.emitJobData(parsed.data as IJobData);
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Handshake in progress')) {
        return reply.code(409).send({ error: 'Handshake in progress' });
      }
      throw err;
    }
  });
};
