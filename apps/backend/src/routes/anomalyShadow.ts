// ----------------------------------------------------------------------
// Phase 41: Shadow anomaly routes (SHADOW-04, D-20, D-21, D-22, D-23, D-24)
// ----------------------------------------------------------------------
// Plugin-level preHandler gate restricts to WPT + SUPER_ADMIN — CLIENT gets 403.
// Registered at /api/anomaly in server.ts. Ships `/shadow/diff` sub-route.
//
// NOTE (Plan 41-05 consolidation, 2026-04-20): Originally planned under a
// new /api/anomaly/* root alongside the legacy /api/energy/anomaly/* prefix
// (D-19). User directive superseded D-19 and the v1.4-start "no rename churn"
// decision — ALL anomaly endpoints now live under /api/anomaly/*. Legacy
// /api/energy/anomaly/* is GONE (breaking change, accepted by user).

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';

import {
  shadowDiffResponseSchema,
  UserRole,
  type IShadowDiffResponse,
} from '@wpt/types';

import { requireRole } from '../auth/authHooks.js';
import { MachineShadowAnomalyEventService } from '../services/anomaly/shadow/machineShadowAnomalyEventService.js';

// D-23: query schema — from/to optional (default 24h window), modeKey optional.
const shadowDiffQuerySchema = z.object({
  from:    z.string().datetime().optional(),
  to:      z.string().datetime().optional(),
  modeKey: z.string().min(1).max(100).optional(),
});

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;  // D-23

export const anomalyShadowRoutes: FastifyPluginAsync = async (server) => {
  // D-20: plugin-level preHandler gate. WPT + SUPER_ADMIN only.
  // CLIENT receives 403. Unauthenticated receives 401 (requireRole chains through requireAuth).
  server.addHook('preHandler', requireRole(UserRole.WPT, UserRole.SUPER_ADMIN));

  /**
   * SHADOW-04 — GET /api/anomaly/shadow/diff
   * Response: IShadowDiffResponse (totals + byModeKey + window).
   * Query: ?from=ISO&to=ISO&modeKey=string (all optional).
   */
  server.get('/shadow/diff', async (request, reply) => {
    const parsed = shadowDiffQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid query parameters',
        issues: parsed.error.issues,
      });
    }

    // D-23: default 24h window, anchored at request time.
    const now = new Date();
    const to   = parsed.data.to   ? new Date(parsed.data.to)   : now;
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(now.getTime() - DEFAULT_WINDOW_MS);

    if (from.getTime() > to.getTime()) {
      return reply.code(400).send({
        error: 'Invalid window: from > to',
      });
    }

    try {
      const response: IShadowDiffResponse = await MachineShadowAnomalyEventService.getDiff({
        from,
        to,
        modeKey: parsed.data.modeKey,
      });

      // Defensive contract check — fail loud if service returns a shape that
      // doesn't match the Zod schema (catches regressions before they reach clients).
      const validated = shadowDiffResponseSchema.parse(response);
      return reply.send(validated);
    } catch (err) {
      server.log.error(
        { name: 'MachineAnomalyShadowDiff', err: (err as Error).message },
        'Failed to compute shadow diff',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
};
