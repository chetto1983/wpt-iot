import { eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { cycleRecords } from '../db/schema/energy.js';
import { SparkplugService } from './sparkplugService.js';
import { CloudConfigService } from './cloudConfigService.js';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Background worker to drain the cycle register outbox.
 * Periodically checks for cycle records that haven't been published to the cloud.
 */
export class CloudUplinkWorker {
  private static timer: NodeJS.Timeout | null = null;
  private static logger: FastifyBaseLogger | null = null;
  private static isRunning = false;

  static start(log: FastifyBaseLogger): void {
    this.logger = log;
    this.stop();
    this.timer = setInterval(() => this.drainOutbox(), 60_000); // Every minute
    log.info({ name: 'CloudUplinkWorker' }, 'Cloud Uplink Worker started');
    
    // Immediate first run
    void this.drainOutbox();
  }

  static async drainOutbox(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const cfg = await CloudConfigService.getConfig();
      if (!cfg.enabled || !cfg.publishCycleRecords) {
        this.isRunning = false;
        return;
      }

      // Find unpublished records ordered by ended_at ASC
      const unpublished = await db
        .select()
        .from(cycleRecords)
        .where(isNull(cycleRecords.publishedAt))
        .orderBy(cycleRecords.endedAt);

      if (unpublished.length > 0) {
        this.logger?.info({ name: 'CloudUplinkWorker' }, `Draining ${unpublished.length} cycle records`);
      }

      for (const record of unpublished) {
        try {
          await SparkplugService.publishCycleRecord(record);
          
          // Mark as published
          await db
            .update(cycleRecords)
            .set({ publishedAt: new Date() })
            .where(eq(cycleRecords.id, record.id));
            
        } catch (err) {
          this.logger?.error({ name: 'CloudUplinkWorker', cycleId: record.id, err }, 'Failed to publish cycle record');
          break; // Stop draining on error (e.g. connection down)
        }
      }
    } catch (err) {
      this.logger?.error({ name: 'CloudUplinkWorker', err }, 'Error during outbox drain');
    } finally {
      this.isRunning = false;
    }
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
