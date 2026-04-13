import { dataHub } from '../events/hub.js';
import { EnergyAttributionService } from '../services/energy/index.js';
import type { ICycleClosedEvent } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Subscribe to `cycle:closed` events and persist each cycle to
 * `cycle_records` via EnergyAttributionService.insertCycleFromEvent.
 *
 * ENRG-02 (per-cycle records), ENRG-03 (idempotent persistence) — the
 * insertCycleFromEvent call is a no-op if the (reset_epoch, cycle_number)
 * row already exists, so this subscriber is safe to race with the
 * 5-minute backfill scheduler registered in routes/energy.ts.
 *
 * Pattern mirrors `apps/backend/src/persistence/machineStore.ts:17-33`:
 *   - start-function, closure-free, logs and continues on error
 *   - never crashes the process on a bad cycle
 *   - registered from the Fastify energy route plugin body (Plan 19-06
 *     Pattern 3 per RESEARCH.md — NOT a hypothetical onReady hook)
 */
export function startCyclePersister(log: IStoreLogger): void {
  dataHub.onCycleClosed(async (event: ICycleClosedEvent) => {
    try {
      await EnergyAttributionService.insertCycleFromEvent(event, log);
    } catch (err) {
      // D-12: Log and continue — cycleTracker FSM keeps running, the next
      // backfill scan will re-attempt any missed cycles via the idempotency
      // check in insertCycleFromEvent.
      log.error(
        {
          name: 'CyclePersister',
          err: (err as Error).message,
          cycleNumber: event.cycleNumber,
          resetEpoch: event.resetEpoch,
        },
        'Failed to persist cycle record',
      );
    }
  });
  log.info(
    { name: 'CyclePersister' },
    'Cycle persistence subscriber started',
  );
}
