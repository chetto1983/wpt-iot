// ----------------------------------------------------------------------
// Phase 42: Streaming replay service (DEBUG-03 — D-01..D-10, D-17, D-18, D-22, D-23)
// ----------------------------------------------------------------------
// Server-side SQL cursor pipeline inside db.transaction.
//   BEGIN → DECLARE c NO SCROLL CURSOR FOR SELECT … → FETCH FORWARD 500
//   → mapReplayRow → detector.observe → batch 100 rows → sendToSession
//   → progress every 500 rows OR 250 ms → end frame → CLOSE c → COMMIT.
//
// Cancellation:  AbortSignal.any([wsCloseSignal, AbortSignal.timeout(600_000)])
// Concurrency:   Map<streamId, job>.size is the semaphore (cap 2, throws on overflow).
// Back-pressure: socket.bufferedAmount polled before each send (1 MB / 256 KB / 10 s).
//
// Zero new runtime deps: cursor via raw `sql`DECLARE … CURSOR`` inside
// Drizzle 0.45's db.transaction(tx). `pg-query-stream` / `pg-cursor` /
// Drizzle's WIP iterator are deliberately NOT used per the v1.4 zero-dep
// scope wall.
//
// Primary-source citations for the patterns without in-repo precedent:
//   - https://nearform.com/insights/using-abortsignal-in-node-js/  (D-10 wiring)
//   - https://github.com/websockets/ws/issues/492                   (D-05 bufferedAmount rationale)
//   - https://www.cybertec-postgresql.com/en/declare-cursor-in-postgresql-or-how-to-reduce-memory-consumption/  (D-06 cursor)
//   - https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount
//   - https://orm.drizzle.team/docs/select                          (Drizzle 0.45 tx/iterator status)

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { FastifyBaseLogger } from 'fastify';
import { WsMessageType, type IAnomalyContributor, type IReplayFrame } from '@wpt/types';

import { db } from '../../../db/index.js';
import { OnlineAnomalyDetector } from '../onlineAnomalyDetector.js';
import {
  mapReplayRow,
  asIsoString,
  type IReplaySnapshotRow,
} from '../anomalyReplayHelpers.js';
import {
  sendToSession,
  getSessionSocket,
  registerOnSessionClose,
} from '../../../ws/broadcaster.js';

// ----------------------------------------------------------------------
// Constants — all D-literal values from CONTEXT.md
// ----------------------------------------------------------------------

const MAX_CONCURRENT_JOBS = 2;                 // D-08: global semaphore cap
const FETCH_ROWS_PER_STEP = 500;               // D-06: FETCH FORWARD 500
const CHUNK_ROWS_PER_FRAME = 100;              // D-07: rows per chunk frame
const PROGRESS_FRAME_INTERVAL_ROWS = 500;      // D-07: progress cadence (rows)
const PROGRESS_FRAME_INTERVAL_MS = 250;        // D-07: progress cadence (ms)
const MAX_REPLAY_DURATION_MS = 600_000;        // D-10: 10-min composite timeout
const BUFFERED_HIGH_WATER_BYTES = 1_048_576;   // D-05: 1 MB pause production
const BUFFERED_LOW_WATER_BYTES  = 262_144;     // D-05: 256 KB resume
const BUFFERED_STALL_TIMEOUT_MS = 10_000;      // D-05: 10 s over high → terminate
const BUFFERED_POLL_INTERVAL_MS = 50;          // poll cadence for bufferedAmount
const DEFAULT_MAX_ROWS = 20_000;               // matches sync sibling default

// ----------------------------------------------------------------------
// Error classes
// ----------------------------------------------------------------------

/** D-08/D-23: thrown by start() when activeJobs.size >= MAX_CONCURRENT_JOBS.
 *  Route layer (Plan 42-04) maps this to HTTP 429 with
 *  { error: 'Concurrency limit', retryAfter: 30, active: 2 }. */
export class AnomalyReplayConcurrencyError extends Error {
  readonly activeJobs: number;
  constructor(activeJobs: number) {
    super(`Replay concurrency limit reached: ${activeJobs} active jobs`);
    this.name = 'AnomalyReplayConcurrencyError';
    this.activeJobs = activeJobs;
  }
}

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------

export interface IReplayStartParams {
  from: Date;
  to: Date;
  maxRows?: number;
  topN?: number;
}

interface IReplayJob {
  streamId: string;
  sessionId: string;
  controller: AbortController;
  startedAt: number;
  processed: number;
  total: number;
  seq: number;  // monotonic per-frame counter (D-03)
}

interface IChunkRow {
  observedAt: string;
  modeKey: string;
  score: number;
  flagged: boolean;
  topContributors: IAnomalyContributor[];
}

// ----------------------------------------------------------------------
// Service (singleton class — Map IS the semaphore per D-08/D-23)
// ----------------------------------------------------------------------

class AnomalyDebugReplayServiceImpl {
  private readonly activeJobs = new Map<string, IReplayJob>();

  /** D-02: synchronous start; schedules the async cursor loop.
   *  Throws AnomalyReplayConcurrencyError BEFORE allocating resources. */
  start(
    params: IReplayStartParams,
    sessionId: string,
    log: FastifyBaseLogger,
  ): { streamId: string } {
    if (this.activeJobs.size >= MAX_CONCURRENT_JOBS) {
      throw new AnomalyReplayConcurrencyError(this.activeJobs.size);
    }

    const streamId = randomUUID();

    // D-10: composite AbortSignal — ws close + 10-min runaway safety net.
    const controller = new AbortController();
    const wsCloseSignal = controller.signal;
    const timeoutSignal = AbortSignal.timeout(MAX_REPLAY_DURATION_MS);
    const combinedSignal = AbortSignal.any([wsCloseSignal, timeoutSignal]);

    const job: IReplayJob = {
      streamId,
      sessionId,
      controller,
      startedAt: Date.now(),
      processed: 0,
      total: 0,
      seq: 0,
    };
    this.activeJobs.set(streamId, job);

    // Fire-and-forget — errors are reported via an 'error' frame + audit log.
    void this.runJob(job, params, combinedSignal, log)
      .catch((err: unknown) => {
        // Last-chance catch: runJob's try/finally already handles known paths.
        log.error(
          { name: 'MachineAnomalyDebugReplay', streamId, err: (err as Error).message },
          'Unhandled replay job error',
        );
      })
      .finally(() => {
        this.activeJobs.delete(streamId);
      });

    return { streamId };
  }

  /** D-04: HTTP DELETE cancellation path. Returns true if aborting an active job. */
  cancel(streamId: string): boolean {
    const job = this.activeJobs.get(streamId);
    if (!job) return false;
    job.controller.abort('cancel');
    return true;
  }

  /** D-04/D-10: session-close fan-out. Broadcaster calls this via registerOnSessionClose. */
  onSessionClose(sessionId: string): void {
    for (const job of this.activeJobs.values()) {
      if (job.sessionId === sessionId) {
        job.controller.abort('ws-closed');
      }
    }
  }

  /** TEST-ONLY hook: inspect active job count for 42-05 concurrency test. */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  // --------------------------------------------------------------------
  // Internal: the actual cursor loop
  // --------------------------------------------------------------------

  private async runJob(
    job: IReplayJob,
    params: IReplayStartParams,
    signal: AbortSignal,
    log: FastifyBaseLogger,
  ): Promise<void> {
    const { streamId, sessionId } = job;
    const maxRows = params.maxRows ?? DEFAULT_MAX_ROWS;
    const detector = new OnlineAnomalyDetector();  // D-17: defaults, zero overrides

    const startMs = Date.now();
    let lastProgressEmitMs = startMs;

    // Buffer for the current chunk frame being accumulated.
    let chunkBuffer: IChunkRow[] = [];

    try {
      await db.transaction(async (tx) => {
        // D-06: DECLARE NO SCROLL CURSOR — lets Postgres stream vs materialize.
        // Uses Drizzle's raw sql`...` template inside tx.execute.
        await tx.execute(sql`
          DECLARE replay_cursor NO SCROLL CURSOR FOR
          SELECT
            timestamp, selected_cycle, current_phase, machine_status,
            garbage_temp, chamber_pressure, main_motor_speed, main_motor_current, main_motor_torque,
            vacuum_pump_speed_01, energy_consumption, rms_curr_l1, rms_curr_l2, rms_curr_l3,
            material_input_weight, material_output_weight, vacuum_pump_speed_02, rms_curr_n,
            thermo_left_lower, thermo_left_medium, thermo_left_upper,
            thermo_right_lower, thermo_right_medium, thermo_right_upper,
            holding_temp_setpoint, water_consumption,
            line_volt_l1_l2, line_volt_l2_l3, line_volt_l3_l1,
            line_neutral_volt_l1, line_neutral_volt_l2, line_neutral_volt_l3,
            pf_total,
            thermo_left_high_lower, thermo_left_high_medium, thermo_left_high_upper, thermo_right_high_lower
          FROM machine_snapshots
          WHERE timestamp >= ${params.from.toISOString()}::timestamptz
            AND timestamp <  ${params.to.toISOString()}::timestamptz
          ORDER BY timestamp ASC
          LIMIT ${maxRows}
        `);

        try {
          // D-07 cursor loop: FETCH 500, then emit 100-row chunks within.
          while (true) {
            signal.throwIfAborted();

            const fetchResult = await tx.execute(
              sql`FETCH FORWARD ${FETCH_ROWS_PER_STEP} FROM replay_cursor`,
            );
            // Drizzle's tx.execute wraps pg's QueryResult; rows live on .rows.
            const rows = (fetchResult.rows ?? []) as unknown as IReplaySnapshotRow[];
            if (rows.length === 0) break;

            job.total = Math.max(job.total, job.processed + rows.length);

            for (const row of rows) {
              signal.throwIfAborted();

              const result = detector.observe(mapReplayRow(row));
              const observedAt = asIsoString(row.timestamp);

              chunkBuffer.push({
                observedAt,
                modeKey: result.modeKey,
                score: result.score,
                flagged: result.flagged,
                topContributors: result.topContributors,
              });

              job.processed += 1;

              if (chunkBuffer.length >= CHUNK_ROWS_PER_FRAME) {
                await emitAndWaitForBackpressure(sessionId, {
                  type: WsMessageType.REPLAY_FRAME,
                  streamId,
                  seq: job.seq++,
                  phase: 'chunk',
                  rows: chunkBuffer,
                }, signal, log);
                chunkBuffer = [];
              }

              // D-07: progress cadence — every 500 rows OR every 250 ms.
              const nowMs = Date.now();
              if (
                job.processed % PROGRESS_FRAME_INTERVAL_ROWS === 0 ||
                (nowMs - lastProgressEmitMs) >= PROGRESS_FRAME_INTERVAL_MS
              ) {
                const elapsed = nowMs - startMs;
                const etaMs = job.total > 0 && job.processed > 0
                  ? Math.max(0, Math.round((elapsed / job.processed) * (job.total - job.processed)))
                  : 0;
                sendToSession(sessionId, {
                  type: WsMessageType.REPLAY_FRAME,
                  streamId,
                  seq: job.seq++,
                  phase: 'progress',
                  processed: job.processed,
                  total: job.total,
                  etaMs,
                });
                lastProgressEmitMs = nowMs;
              }
            }

            if (rows.length < FETCH_ROWS_PER_STEP) break;  // exhausted
          }

          // Flush any remainder in the chunk buffer.
          if (chunkBuffer.length > 0) {
            await emitAndWaitForBackpressure(sessionId, {
              type: WsMessageType.REPLAY_FRAME,
              streamId,
              seq: job.seq++,
              phase: 'chunk',
              rows: chunkBuffer,
            }, signal, log);
            chunkBuffer = [];
          }

          // Terminal 'end' frame.
          const durationMs = Date.now() - startMs;
          const endFrame: IReplayFrame = {
            type: WsMessageType.REPLAY_FRAME,
            streamId,
            seq: job.seq++,
            phase: 'end',
            processed: job.processed,
            durationMs,
            ok: true,
          };
          sendToSession(sessionId, endFrame);

          // D-18: audit log on success.
          log.info(
            {
              name: 'MachineAnomalyDebugReplay',
              configSource: 'defaults',
              requestedBy: sessionId,
              streamId,
              from: params.from.toISOString(),
              to: params.to.toISOString(),
              rowCount: job.processed,
              durationMs,
            },
            'Replay completed',
          );
        } finally {
          // D-10: always CLOSE the cursor. Transaction commit/rollback also
          // closes the cursor implicitly — belt and suspenders.
          await tx.execute(sql`CLOSE replay_cursor`).catch(() => void 0);
        }
      });
    } catch (err) {
      const isAbort = (err as Error)?.name === 'AbortError' || signal.aborted;
      const reason = signal.reason;
      const errorCode: string = isAbort
        ? (reason === 'ws-closed' ? 'ws-closed' : (reason === 'cancel' ? 'aborted' : 'aborted'))
        : 'internal';
      const errorFrame: IReplayFrame = {
        type: WsMessageType.REPLAY_FRAME,
        streamId,
        seq: job.seq++,
        phase: 'error',
        code: errorCode,
        message: isAbort ? 'Replay aborted' : (err as Error).message,
      };
      // Send even though the job is failing — client needs the terminal frame.
      sendToSession(sessionId, errorFrame);

      // D-18: audit log on failure. Use .warn for abort, .error for internal.
      const durationMs = Date.now() - startMs;
      const auditPayload = {
        name: 'MachineAnomalyDebugReplay',
        configSource: 'defaults',
        requestedBy: sessionId,
        streamId,
        from: params.from.toISOString(),
        to: params.to.toISOString(),
        rowCount: job.processed,
        durationMs,
        err: (err as Error).message,
      };
      if (isAbort) {
        log.warn(auditPayload, 'Replay aborted');
      } else {
        log.error(auditPayload, 'Replay failed');
      }
      // Do NOT rethrow — the outer start() wraps in .catch to avoid unhandled
      // rejection; rethrowing would duplicate the error path.
    }
  }
}

/**
 * D-05: WS back-pressure gate. Pause until socket.bufferedAmount drops below
 * the low watermark, or abort if the high watermark persists > 10 s.
 * Returns when the send completes (fire-and-forget semantics — the send
 * itself goes via sendToSession inside the caller, but we block here to
 * pace the producer).
 */
async function emitAndWaitForBackpressure(
  sessionId: string,
  payload: IReplayFrame,
  signal: AbortSignal,
  log: FastifyBaseLogger,
): Promise<void> {
  signal.throwIfAborted();

  const socket = getSessionSocket(sessionId);
  if (!socket) {
    // Session is gone — force-abort via signal (will be caught by the outer try).
    // No point continuing to generate frames nobody will receive.
    throw Object.assign(new Error('Session socket not connected'), { name: 'AbortError' });
  }

  // Drain gate: if we're above high water, wait for low water or stall timeout.
  if (socket.bufferedAmount > BUFFERED_HIGH_WATER_BYTES) {
    const stallStart = Date.now();
    while (socket.bufferedAmount > BUFFERED_LOW_WATER_BYTES) {
      signal.throwIfAborted();
      if ((Date.now() - stallStart) >= BUFFERED_STALL_TIMEOUT_MS) {
        log.warn(
          { name: 'MachineAnomalyDebugReplay', sessionId, bufferedAmount: socket.bufferedAmount },
          'WS back-pressure stall > 10s — terminating socket',
        );
        try {
          socket.terminate();
        } catch {
          // swallow — already tearing down
        }
        throw Object.assign(new Error('WS back-pressure stall'), { name: 'AbortError' });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, BUFFERED_POLL_INTERVAL_MS));
    }
  }

  sendToSession(sessionId, payload);
}

// ----------------------------------------------------------------------
// Singleton + broadcaster hook registration
// ----------------------------------------------------------------------

export const AnomalyDebugReplayService = new AnomalyDebugReplayServiceImpl();

// D-04/D-10: subscribe to session-close events. Broadcaster fans out on
// every removeClient; we abort any active jobs that belong to the departing
// session.
registerOnSessionClose((sessionId) => {
  AnomalyDebugReplayService.onSessionClose(sessionId);
});
