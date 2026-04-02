import { eq, and, isNull } from 'drizzle-orm';
import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { alarmEvents } from '../db/schema/alarms.js';
import type { IAlarmTransition } from '../events/types.js';
import { getAlarmDescription } from '../i18n/alarmDescriptions.js';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Subscribe to alarm:change events and persist transitions to PostgreSQL.
 * Per D-02: ISA 18.2 compatible with transitionType column.
 * Per D-12: DB write failures are logged but never crash the process.
 */
export function startAlarmStore(log: IStoreLogger): void {
  dataHub.onAlarmChange(async (transitions: IAlarmTransition[]) => {
    for (const t of transitions) {
      try {
        if (t.active) {
          // ACTIVE transition: insert new row
          await db.insert(alarmEvents).values({
            alarmIndex: t.alarmIndex,
            wordIndex: t.wordIndex,
            bitIndex: t.bitIndex,
            active: true,
            transitionType: 'ACTIVE',
            activatedAt: t.timestamp,
            resetAt: null,
            descriptionIt: getAlarmDescription(t.alarmIndex, 'it'),
            descriptionEn: getAlarmDescription(t.alarmIndex, 'en'),
          });
        } else {
          // CLEAR transition: update the most recent active row for this alarm
          await db.update(alarmEvents)
            .set({
              resetAt: t.timestamp,
              active: false,
              transitionType: 'CLEAR',
            })
            .where(
              and(
                eq(alarmEvents.alarmIndex, t.alarmIndex),
                isNull(alarmEvents.resetAt),
              ),
            );
        }
      } catch (err) {
        // D-12: Log and continue
        log.error(
          { name: 'AlarmStore', alarmIndex: t.alarmIndex, active: t.active, err: (err as Error).message },
          'Failed to persist alarm transition',
        );
      }
    }
  });
  log.info({ name: 'AlarmStore' }, 'Alarm persistence subscriber started');
}

/** Query currently active alarms for startup seeding (D-01) */
export async function getActiveAlarmIndices(): Promise<number[]> {
  const rows = await db.select({ alarmIndex: alarmEvents.alarmIndex })
    .from(alarmEvents)
    .where(
      and(
        eq(alarmEvents.active, true),
        isNull(alarmEvents.resetAt),
      ),
    );
  return rows.map(r => r.alarmIndex);
}
