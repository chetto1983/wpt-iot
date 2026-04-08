import type { FastifyPluginAsync } from 'fastify';
import { UserRole, JobDataSchema, RemoteJobEnable, MaintenanceRequest, RemoteCycleSelection, CycleType } from '@wpt/types';
import type { IJobData } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { writeJob } from '../udp/handshakeFsm.js';
import { getSockets } from '../udp/sockets.js';
import { dataHub } from '../events/hub.js';
import { latestState } from '../cache/latestState.js';

/**
 * Job/commessa management routes (read/write PLC job parameters).
 * All routes require WPT or SUPER_ADMIN role.
 */
export const jobRoutes: FastifyPluginAsync = async (server) => {
  // Plugin-level preHandler: WPT + SUPER_ADMIN only
  server.addHook('preHandler', requireRole(UserRole.WPT, UserRole.SUPER_ADMIN));

  /**
   * POST /jobs/read
   *
   * Returns the current job data as seen on the real PLC. We do NOT run a
   * 9093 handshake read against the real ABB AC500 firmware because port
   * 9090 is write-only for job data per packet-9090-job-data.md — the real
   * PLC never sends 92/96-byte job replies on 9090. Instead, job fields are
   * already embedded in the continuous 328-byte machine_data broadcast at
   * S1_S_DATO_2..4 (supervisor / orderNumber / serialNumber).
   *
   * Trying to go through the FSM here would pick up the next 328-byte
   * machine_data packet on 9090 and parseJobData would misinterpret it as a
   * 96-byte job packet, producing garbage (e.g. cycleType=37, out-of-enum).
   *
   * R1_* INT fields (remoteJobEnable, maintenanceRequest, remoteCycleSelection,
   * cycleType, spareInt02, spareInt03) are write-only to the PLC with no
   * corresponding S1_* broadcast. We default them to NO_REQUEST / NO_CYCLE.
   * The operator then edits them and writes back via POST /jobs/write.
   */
  server.post('/jobs/read', async (_request, _reply) => {
    const snap = latestState.getMachineSnapshot();
    const job: IJobData = {
      supervisor: snap?.supervisor ?? '',
      orderNumber: snap?.orderNumber ?? '',
      serialNumber: snap?.serialNumber ?? '',
      remoteJobEnable: RemoteJobEnable.NO_REQUEST,
      maintenanceRequest: MaintenanceRequest.NO_REQUEST,
      remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
      cycleType: CycleType.NO_CYCLE,
      spareInt02: 0,
      spareInt03: 0,
    };
    dataHub.emitJobData(job);
    return { job };
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
