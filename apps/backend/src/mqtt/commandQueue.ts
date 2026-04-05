import type { IMqttCommandResponse } from '@wpt/types';

/** A queued command with its resolver */
interface IQueuedCommand {
  requestId: string;
  execute: () => Promise<IMqttCommandResponse>;
  resolve: (response: IMqttCommandResponse) => void;
}

const MAX_QUEUE_DEPTH = 5;
const DEDUP_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * FIFO command queue that serializes PLC writes.
 * Only one command executes at a time through the handshake FSM.
 * Includes request ID deduplication for QoS 1 redeliveries.
 */
export class CommandQueue {
  private queue: IQueuedCommand[] = [];
  private processing = false;
  private dedupCache = new Map<string, { response: IMqttCommandResponse; expiresAt: number }>();

  /** Number of commands currently queued (including the one being processed) */
  get depth(): number {
    return this.queue.length;
  }

  /**
   * Enqueue a command for serial execution.
   * Returns the response when the command completes.
   * Rejects immediately if queue depth exceeds MAX_QUEUE_DEPTH.
   * Returns cached response for duplicate requestIds (QoS 1 redelivery).
   */
  async enqueue(
    requestId: string,
    execute: () => Promise<IMqttCommandResponse>,
  ): Promise<IMqttCommandResponse> {
    // Check dedup cache (QoS 1 redelivery protection)
    const cached = this.dedupCache.get(requestId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.response;
    }

    // Check queue depth
    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      const rejection: IMqttCommandResponse = {
        requestId,
        status: 'rejected',
        message: `Command queue full (max ${MAX_QUEUE_DEPTH})`,
        timestamp: new Date().toISOString(),
      };
      return rejection;
    }

    // Enqueue and wait
    return new Promise<IMqttCommandResponse>((resolve) => {
      this.queue.push({ requestId, execute, resolve });
      void this.processNext();
    });
  }

  /** Process commands one at a time */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const cmd = this.queue.shift()!;
    try {
      const response = await cmd.execute();
      // Cache for dedup
      this.dedupCache.set(cmd.requestId, {
        response,
        expiresAt: Date.now() + DEDUP_CACHE_TTL_MS,
      });
      cmd.resolve(response);
    } catch (err) {
      const errorResponse: IMqttCommandResponse = {
        requestId: cmd.requestId,
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      this.dedupCache.set(cmd.requestId, {
        response: errorResponse,
        expiresAt: Date.now() + DEDUP_CACHE_TTL_MS,
      });
      cmd.resolve(errorResponse);
    }

    this.processing = false;
    // Process next in queue
    void this.processNext();
  }

  /** Clean expired entries from dedup cache */
  cleanDedupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.dedupCache) {
      if (entry.expiresAt <= now) {
        this.dedupCache.delete(key);
      }
    }
  }

  /** Reset queue and cache (for shutdown/testing) */
  reset(): void {
    this.queue = [];
    this.processing = false;
    this.dedupCache.clear();
  }
}
