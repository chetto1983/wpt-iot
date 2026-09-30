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
      // materialInputWeight now comes from the REAL PLC field Spare_R_02. The
      // legacy material_input_weight database column is still INTEGER, while
      // the exact value is persisted in spare_real_02 by the snapshot spread.
      // Coerce only the compatibility column so decimal weights cannot reject
      // the entire row at insert time.
      const persistedSnapshot = Number.isFinite(snapshot.materialInputWeight)
        ? {
            ...snapshot,
            materialInputWeight: Math.round(snapshot.materialInputWeight),
          }
        : snapshot;

      await db.insert(machineSnapshots).values({
        timestamp,
        ...persistedSnapshot,
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
