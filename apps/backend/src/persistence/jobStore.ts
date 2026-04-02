import { eq } from 'drizzle-orm';
import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { jobs, jobChanges } from '../db/schema/jobs.js';
import type { IJobData } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Fixed ID for single-machine job row (per Research Pitfall 5) */
const FIXED_JOB_ID = 1;

/**
 * Subscribe to job:data events and persist job params with diff logging.
 * Per D-07: Mirror + diff log model. Single row upsert.
 * Per D-08: Same pattern as userStore for consistency.
 * Per D-12: DB failures logged, never crash.
 */
export function startJobStore(log: IStoreLogger): void {
  dataHub.onJobData(async (job: IJobData) => {
    try {
      // 1. Read current job state for diff detection
      const [current] = await db.select().from(jobs).where(eq(jobs.id, FIXED_JOB_ID));

      // 2. Detect diff (skip on first read when current is undefined)
      if (current && (
        current.supervisor !== job.supervisor ||
        current.orderNumber !== job.orderNumber ||
        current.serialNumber !== job.serialNumber ||
        current.remoteJobEnable !== job.remoteJobEnable ||
        current.maintenanceRequest !== job.maintenanceRequest ||
        current.remoteCycleSelection !== job.remoteCycleSelection ||
        current.cycleType !== job.cycleType
      )) {
        await db.insert(jobChanges).values({
          previousSupervisor: current.supervisor,
          previousOrderNumber: current.orderNumber,
          previousSerialNumber: current.serialNumber,
          previousRemoteJobEnable: current.remoteJobEnable,
          previousMaintenanceRequest: current.maintenanceRequest,
          previousRemoteCycleSelection: current.remoteCycleSelection,
          previousCycleType: current.cycleType,
          currentSupervisor: job.supervisor,
          currentOrderNumber: job.orderNumber,
          currentSerialNumber: job.serialNumber,
          currentRemoteJobEnable: job.remoteJobEnable,
          currentMaintenanceRequest: job.maintenanceRequest,
          currentRemoteCycleSelection: job.remoteCycleSelection,
          currentCycleType: job.cycleType,
        });
      }

      // 3. Upsert job row with fixed ID
      await db.insert(jobs).values({
        id: FIXED_JOB_ID,
        supervisor: job.supervisor,
        orderNumber: job.orderNumber,
        serialNumber: job.serialNumber,
        remoteJobEnable: job.remoteJobEnable,
        maintenanceRequest: job.maintenanceRequest,
        remoteCycleSelection: job.remoteCycleSelection,
        cycleType: job.cycleType,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: jobs.id,
        set: {
          supervisor: job.supervisor,
          orderNumber: job.orderNumber,
          serialNumber: job.serialNumber,
          remoteJobEnable: job.remoteJobEnable,
          maintenanceRequest: job.maintenanceRequest,
          remoteCycleSelection: job.remoteCycleSelection,
          cycleType: job.cycleType,
          updatedAt: new Date(),
        },
      });

      log.info({ name: 'JobStore' }, 'Job data persisted');
    } catch (err) {
      log.error(
        { name: 'JobStore', err: (err as Error).message },
        'Failed to persist job data',
      );
    }
  });
  log.info({ name: 'JobStore' }, 'Job persistence subscriber started');
}
