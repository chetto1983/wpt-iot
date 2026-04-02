import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { machineSnapshots } from '../db/schema/machine.js';
import type { IMachineSnapshot } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Subscribe to machine:data events and persist each snapshot to PostgreSQL.
 * Per D-12: DB write failures are logged but never crash the process.
 * Per D-08: The in-memory cache stays current even if a DB write fails.
 */
export function startMachineStore(log: IStoreLogger): void {
  dataHub.onMachineData(async (snapshot: IMachineSnapshot, timestamp: Date) => {
    try {
      await db.insert(machineSnapshots).values({
        timestamp,
        ...snapshot,
      });
    } catch (err) {
      // D-12: Log and continue -- in-memory cache stays current, lost snapshots acceptable
      log.error(
        { name: 'MachineStore', err: (err as Error).message },
        'Failed to persist machine snapshot',
      );
    }
  });
  log.info({ name: 'MachineStore' }, 'Machine persistence subscriber started');
}
