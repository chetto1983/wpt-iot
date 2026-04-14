import { eq, isNull, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { cycleRecords } from '../db/schema/energy.js';
import { SparkplugService } from './sparkplugService.js';
import { MqttConfigService } from './configService.js';
import { dataHub } from '../events/hub.js';
import type { FastifyBaseLogger } from 'fastify';
import type { ICycleClosedEvent } from '@wpt/types';

/**
 * Background worker to drain the cycle register outbox.
 *
 * Implements the outbox pattern per CONTEXT.md D-04:
 * 1. Immediate publish on cycle:closed event (QoS 1)
 * 2. On successful publish: UPDATE published_at = NOW()
 * 3. On failed publish: leave published_at NULL for drain retry
 * 4. 60s drain loop: SELECT WHERE published_at IS NULL ORDER BY ended_at ASC
 */
export class CloudUplinkWorker {
  private static timer: NodeJS.Timeout | null = null;
  private static logger: FastifyBaseLogger | null = null;
  private static isRunning = false;
  private static cycleClosedHandler: ((event: ICycleClosedEvent) => void) | null = null;

  static start(log: FastifyBaseLogger): void {
    this.logger = log;
    this.stop();

    // Subscribe to cycle close events for immediate publish
    this.cycleClosedHandler = async (event: ICycleClosedEvent) => {
      try {
        await this.publishAndMark(event);
      } catch (err) {
        // Failed - will be retried by drain loop
        this.logger?.warn({ name: 'CloudUplinkWorker', err, cycleNumber: event.cycleNumber },
          'Immediate cycle publish failed, will retry via drain');
      }
    };
    dataHub.onCycleClosed(this.cycleClosedHandler);

    // 60s drain for catchup and retry
    this.timer = setInterval(() => this.drainOutbox(), 60_000);
    log.info({ name: 'CloudUplinkWorker' }, 'Cloud Uplink Worker started (immediate + drain)');

    // Immediate first drain run
    void this.drainOutbox();
  }

  /**
   * Trigger an out-of-band drain on MQTT reconnect.
   *
   * Called by SparkplugService whenever its mqtt.js client fires the `connect`
   * event after a re-establishment (the initial connect does not count — births
   * are published first and the immediate drain in start() covers that path).
   *
   * Guards against concurrent runs via the existing `isRunning` flag in
   * drainOutbox(), so calling this while a 60s-tick drain is in progress is safe.
   */
  static onMqttReconnect(): void {
    this.logger?.info({ name: 'CloudUplinkWorker', reason: 'reconnect-drain' },
      'MQTT reconnect detected — triggering out-of-band outbox drain');
    void this.drainOutbox();
  }

  /**
   * Publish a cycle record and mark it as published on success.
   * Called both by immediate handler and drain loop.
   */
  private static async publishAndMark(record: ICycleClosedEvent | { id: number; cycleNumber: number } & Record<string, unknown>): Promise<void> {
    const cfg = await MqttConfigService.getConfig();
    if (!cfg.enabled || !cfg.publishCycleRecords) return;

    await SparkplugService.publishCycleRecord(record);

    // Mark as published if successful (has id means it's a DB record)
    if ('id' in record && typeof record.id === 'number') {
      await db
        .update(cycleRecords)
        .set({ publishedAt: new Date() })
        .where(eq(cycleRecords.id, record.id));

      this.logger?.info({ name: 'CloudUplinkWorker', cycleNumber: record.cycleNumber },
        'Cycle record marked as published');
    }
  }

  /**
   * Drain loop: find unpublished records and attempt to publish them.
   * Orders by ended_at ASC for FIFO processing.
   */
  static async drainOutbox(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const cfg = await MqttConfigService.getConfig();
      if (!cfg.enabled || !cfg.publishCycleRecords) {
        this.isRunning = false;
        return;
      }

      // Find unpublished records ordered by ended_at ASC (FIFO drain)
      const unpublished = await db
        .select()
        .from(cycleRecords)
        .where(isNull(cycleRecords.publishedAt))
        .orderBy(asc(cycleRecords.endedAt))
        .limit(100);

      if (unpublished.length > 0) {
        this.logger?.info({ name: 'CloudUplinkWorker', count: unpublished.length },
          `Draining ${unpublished.length} cycle records`);
      }

      for (const record of unpublished) {
        try {
          await this.publishAndMark(record);
        } catch (err) {
          this.logger?.error({ name: 'CloudUplinkWorker', cycleId: record.id, err },
            'Failed to publish cycle record, stopping drain');
          break; // Stop draining on error (e.g. connection down), retry next cycle
        }
      }
    } catch (err) {
      this.logger?.error({ name: 'CloudUplinkWorker', err }, 'Error during outbox drain');
    } finally {
      this.isRunning = false;
    }
  }

  static stop(): void {
    if (this.cycleClosedHandler) {
      dataHub.removeListener('cycle:closed', this.cycleClosedHandler);
      this.cycleClosedHandler = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
