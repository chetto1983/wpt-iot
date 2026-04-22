import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/index.js';
import {
  ALARM_HISTORY_RETENTION_INTERVAL,
  ALARM_RETENTION_RUN_INTERVAL_MS,
} from '../lib/dataRetention.js';

interface IDeleteCountRow {
  deleted_count: number | string;
}

/**
 * alarm_events is a plain table, not a Timescale hypertable.
 * Keep it bounded with an application-owned daily delete against activated_at.
 * The next PLC alarm packet re-seeds any still-active alarm after a restart,
 * so hard-capping very old rows is acceptable on the edge box.
 */
export class AlarmRetentionService {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  static start(logger: FastifyBaseLogger): void {
    if (this.timer) return;

    logger.info(
      {
        name: 'AlarmRetention',
        retention: ALARM_HISTORY_RETENTION_INTERVAL,
        scheduleMs: ALARM_RETENTION_RUN_INTERVAL_MS,
      },
      'Alarm retention cleanup scheduled',
    );

    void this.runNow(logger);

    this.timer = setInterval(() => {
      void this.runNow(logger);
    }, ALARM_RETENTION_RUN_INTERVAL_MS);
    this.timer.unref?.();
  }

  static stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  static async runNow(logger: FastifyBaseLogger): Promise<number> {
    if (this.running) {
      logger.warn({ name: 'AlarmRetention' }, 'Alarm retention cleanup already in progress');
      return 0;
    }

    this.running = true;
    try {
      const result = await db.execute(sql`
        WITH deleted AS (
          DELETE FROM alarm_events
          WHERE activated_at < NOW() - INTERVAL '24 months'
          RETURNING 1
        )
        SELECT count(*)::int AS deleted_count FROM deleted
      `);

      const deletedCount = Number(
        ((result.rows[0] as IDeleteCountRow | undefined)?.deleted_count ?? 0),
      );

      logger.info(
        {
          name: 'AlarmRetention',
          retention: ALARM_HISTORY_RETENTION_INTERVAL,
          deletedCount,
        },
        'Alarm retention cleanup complete',
      );

      return deletedCount;
    } catch (err) {
      logger.error(
        {
          name: 'AlarmRetention',
          retention: ALARM_HISTORY_RETENTION_INTERVAL,
          err: (err as Error).message,
        },
        'Alarm retention cleanup failed',
      );
      throw err;
    } finally {
      this.running = false;
    }
  }
}
