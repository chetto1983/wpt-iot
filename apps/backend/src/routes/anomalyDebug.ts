// ----------------------------------------------------------------------
// Phase 42: Debug detector routes (DEBUG-01, DEBUG-02, DEBUG-03 — D-20..D-23)
// ----------------------------------------------------------------------
// SUPER_ADMIN-only route plugin. Plugin-level preHandler gate blocks CLIENT
// AND WPT (Phase 42 is stricter than Phase 41 shadow routes which allow WPT).
// Registered at /api/anomaly in server.ts (after anomalyRoutes and
// anomalyShadowRoutes). Three inner routes:
//   GET    /debug/state                → live detector introspection (fat BFF)
//   POST   /debug/replay               → start a streaming replay job
//   DELETE /debug/replay/:streamId     → cancel an active replay
//
// Replay results stream back over the admin's already-open /api/ws session
// as WsMessageType.REPLAY_FRAME messages tagged with the returned streamId.

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';

import {
  debugStateResponseSchema,
  replayStartRequestSchema,
  snapshotHistogramResponseSchema,
  UserRole,
} from '@wpt/types';

import { requireRole } from '../auth/authHooks.js';
import { DebugStateService } from '../services/anomaly/debug/debugStateService.js';
import {
  AnomalyDebugReplayService,
  AnomalyReplayConcurrencyError,
} from '../services/anomaly/debug/anomalyDebugReplayService.js';
import { SnapshotHistogramService } from '../services/anomaly/debug/snapshotHistogramService.js';

// D-08: concurrency overflow body. Literal values per CONTEXT.
const CONCURRENCY_LIMIT_RETRY_AFTER_SECONDS = 30;
const CONCURRENCY_LIMIT_MAX_ACTIVE = 2;

// DELETE path param validation: streamId must be a plain string (UUID v4 in
// the canonical case but accept any non-empty for forward-compat).
const streamIdParamSchema = z.object({
  streamId: z.string().min(1).max(128),
});

// D-15 Phase 43: histogram query window. Frontend always supplies explicit
// from/to — no server-side default (CONTEXT D-15 literal).
const histogramQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

const IS_DEV = process.env.NODE_ENV !== 'production';

export const anomalyDebugRoutes: FastifyPluginAsync = async (server) => {
  // D-20: plugin-level preHandler gate. SUPER_ADMIN only (stricter than
  // Phase 41 anomalyShadowRoutes which allows WPT + SUPER_ADMIN).
  // CLIENT and WPT both receive 403. Unauthenticated receives 401.
  server.addHook('preHandler', requireRole(UserRole.SUPER_ADMIN));

  /**
   * DEBUG-01, DEBUG-02 — GET /api/anomaly/debug/state
   * Response: IDebugStateResponse (data.{primary, shadow-section} + meta).
   * Cache-Control: no-store (D-13 — volatile introspection state, ETag cost > payload saving).
   */
  server.get('/debug/state', async (_request, reply) => {
    try {
      const response = DebugStateService.assembleState();

      // D-15: defensive safeParse in dev only. Catches response-shape regressions
      // before they reach the frontend; hot path in prod skips the re-parse.
      if (IS_DEV) {
        const parsed = debugStateResponseSchema.safeParse(response);
        if (!parsed.success) {
          server.log.error(
            {
              name: 'MachineAnomalyDebugState',
              issues: parsed.error.issues.slice(0, 5),
            },
            'Debug state response failed defensive schema validation',
          );
          // In dev, return 500 so the bug surfaces immediately. Production
          // would silently serve the response (schema drift is a dev-time bug).
          return reply.code(500).send({ error: 'Internal schema drift' });
        }
      }

      reply.header('Cache-Control', 'no-store');
      return reply.send(response);
    } catch (err) {
      server.log.error(
        { name: 'MachineAnomalyDebugState', err: (err as Error).message },
        'Failed to assemble debug state',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  /**
   * DEBUG-03 — POST /api/anomaly/debug/replay
   * Body: { from: ISO, to: ISO, maxRows?: number, topN?: number }
   * Response: 200 { streamId }. Results stream over /api/ws as REPLAY_FRAME.
   * Errors: 400 invalid body / 429 concurrency limit / 500 internal.
   */
  server.post('/debug/replay', async (request, reply) => {
    const parsed = replayStartRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid replay parameters',
        issues: parsed.error.issues,
      });
    }

    const sessionId = (request.session as { sessionId?: string }).sessionId;
    if (!sessionId) {
      // Should never happen under requireRole(SUPER_ADMIN) — requireAuth
      // would have 401'd. Defensive: a session without sessionId cannot
      // receive WS frames, so refuse.
      return reply.code(401).send({ error: 'Session required' });
    }

    // D-18: audit log at handler entry. Fire synchronously BEFORE the
    // fire-and-forget start so the record exists even if the job crashes
    // immediately. rowCount + durationMs are filled by the service on end.
    server.log.info(
      {
        name: 'MachineAnomalyDebugReplay',
        configSource: 'defaults',
        requestedBy: sessionId,
        from: parsed.data.from,
        to: parsed.data.to,
        maxRows: parsed.data.maxRows ?? null,
        topN: parsed.data.topN ?? null,
      },
      'Replay requested',
    );

    try {
      const { streamId } = AnomalyDebugReplayService.start(
        {
          from: new Date(parsed.data.from),
          to: new Date(parsed.data.to),
          maxRows: parsed.data.maxRows,
          topN: parsed.data.topN,
        },
        sessionId,
        server.log,
      );
      return reply.code(200).send({ streamId });
    } catch (err) {
      if (err instanceof AnomalyReplayConcurrencyError) {
        // D-08: 429 body shape is { error, retryAfter, active }. Literal values
        // from CONTEXT. Matches RFC 6585 §4 Retry-After semantics (seconds).
        reply.header('Retry-After', String(CONCURRENCY_LIMIT_RETRY_AFTER_SECONDS));
        return reply.code(429).send({
          error: 'Concurrency limit',
          retryAfter: CONCURRENCY_LIMIT_RETRY_AFTER_SECONDS,
          active: CONCURRENCY_LIMIT_MAX_ACTIVE,
        });
      }
      server.log.error(
        { name: 'MachineAnomalyDebugReplay', err: (err as Error).message },
        'Failed to start replay',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  /**
   * DEBUG-03 — DELETE /api/anomaly/debug/replay/:streamId
   * Cancels an active replay. Returns 204 on success, 404 if unknown.
   * The matching WS session receives a terminal 'error' frame with code='aborted'.
   */
  server.delete('/debug/replay/:streamId', async (request, reply) => {
    const parsed = streamIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid streamId',
        issues: parsed.error.issues,
      });
    }

    const cancelled = AnomalyDebugReplayService.cancel(parsed.data.streamId);
    // D-04: 204 on true, 404 on false (REST-correct per CONTEXT Discretion).
    return reply.code(cancelled ? 204 : 404).send();
  });

  /**
   * DEBUG-03 — GET /api/anomaly/debug/snapshot-histogram (Phase 43 D-15)
   * Query: { from: ISO, to: ISO }
   * Response: ISnapshotHistogramResponse ({ buckets, totalCount })
   * Cache-Control: no-store (mirrors D-13 — volatile admin introspection).
   * Inherits plugin-level SUPER_ADMIN gate (D-20).
   */
  server.get('/debug/snapshot-histogram', async (request, reply) => {
    const parsed = histogramQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid histogram range',
        issues: parsed.error.issues,
      });
    }
    const { from, to } = parsed.data;

    try {
      const response = await SnapshotHistogramService.fetch(from, to);

      // D-15 + D-13 mirror: dev-only safeParse to catch drift early.
      if (IS_DEV) {
        const check = snapshotHistogramResponseSchema.safeParse(response);
        if (!check.success) {
          server.log.error(
            {
              name: 'MachineAnomalyDebugHistogram',
              issues: check.error.issues.slice(0, 5),
            },
            'Histogram response failed defensive schema validation',
          );
          return reply.code(500).send({ error: 'Internal schema drift' });
        }
      }

      reply.header('Cache-Control', 'no-store');
      return reply.send(response);
    } catch (err) {
      server.log.error(
        { name: 'MachineAnomalyDebugHistogram', err: (err as Error).message },
        'Failed to query snapshot histogram',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
