import { dataHub } from '../events/hub.js';
import { EnergyAttributionService } from '../services/energy/index.js';
import type { ICycleClosedEvent, ICycleStartEvent } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Persist start and close lifecycle events in emission order.
 *
 * EventEmitter does not await async listeners. A single queue guarantees that
 * a rapid start->close stores the durable start before the close removes it.
 */
export function startCyclePersister(log: IStoreLogger): void {
  let persistenceQueue = Promise.resolve();

  const enqueue = (
    task: () => Promise<void>,
    context: { cycleNumber: number; resetEpoch: number; operation: string },
  ): void => {
    persistenceQueue = persistenceQueue.then(task).catch((err: unknown) => {
      log.error(
        {
          name: 'CyclePersister',
          err: (err as Error).message,
          ...context,
        },
        'Failed to persist cycle lifecycle event',
      );
    });
  };

  dataHub.onCycleStart((event: ICycleStartEvent) => {
    enqueue(
      () => EnergyAttributionService.upsertCycleStart(event, log),
      {
        cycleNumber: event.cycleNumber,
        resetEpoch: event.resetEpoch,
        operation: 'start',
      },
    );
  });

  dataHub.onCycleClosed((event: ICycleClosedEvent) => {
    enqueue(async () => {
      await EnergyAttributionService.insertCycleFromEvent(event, log, {
        source: 'LIVE',
      });
      await EnergyAttributionService.deleteCycleStart(
        event.resetEpoch,
        event.cycleNumber,
      );
    }, {
      cycleNumber: event.cycleNumber,
      resetEpoch: event.resetEpoch,
      operation: 'close',
    });
  });

  log.info(
    { name: 'CyclePersister' },
    'Cycle lifecycle persistence subscriber started',
  );
}
