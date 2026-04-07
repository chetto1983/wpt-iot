import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { EnergyAggregateService } from '../services/energyAggregateService.js';
import type { EnergyBucket } from '@wpt/types';

/**
 * /api/energy/* route plugin — Phase 19 Plan 19-10 scaffold.
 *
 * Shipped in Plan 19-10:
 *   GET /api/energy/aggregate  — calls EnergyAggregateService.getAggregate
 *   GET /api/energy/cycles     — 503 stub (Phase 21 wires it)
 *
 * Plan 19-06 (cycle persister) will extend THIS file with:
 *   - startCycleTracker(server.log)   registration in onReady
 *   - startCyclePersister(server.log) registration in onReady
 *   - EnergyAttributionService.detectAndPersistClosedCycles() backfill
 *     scheduler via setInterval(5min) with onClose cleanup
 *
 * See the PLAN-19-06-HOOK marker below — Plan 19-06 appends its
 * lifecycle wiring there so the read-side surface in this file stays
 * untouched.
 *
 * Phase 19 AUTH CAVEAT: the route is currently wired WITHOUT
 * requireAuth. Phase 21 adds the auth preHandler + role-based field
 * filtering. This is an accepted-for-now disposition per the Plan 19-10
 * threat register (T-19-26 accept-for-now, T-19-28 accept-for-now).
 * The /api/energy/aggregate response is aggregate-only (no raw PLC
 * fields), so no per-field role filter is needed for the v1.1 LAN
 * deployment profile — adding it is a Phase 21 concern.
 */

const aggregateQuerySchema = z.object({
  bucket: z.enum(['5min', 'hour', 'day', 'month']),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const energyRoutes: FastifyPluginAsync = async (server) => {
  // ── PLAN-19-06-HOOK ───────────────────────────────────────────────
  // Plan 19-06 will add subscriber start-function registrations here
  // (startCycleTracker, startCyclePersister) plus the 5-minute
  // idempotent backfill scheduler. Do NOT add them now — Plans 19-06
  // and 19-07 ship the dependencies (cyclePersister.ts and
  // energyAttributionService.ts). Leaving the hook empty in Plan 19-10
  // keeps the read-side surface decoupled from the persister wave.
  // ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/energy/aggregate
   *
   * Query params (all required, validated by Zod):
   *   - bucket: one of '5min' | 'hour' | 'day' | 'month'
   *   - from:   ISO-8601 datetime string (inclusive)
   *   - to:     ISO-8601 datetime string (exclusive)
   *
   * Returns IEnergyAggregateResponse with Italian-formatted display
   * strings (totalKwh, totalCost, totalCo2) so the Phase 21 dashboard
   * can render without re-formatting.
   */
  server.get('/api/energy/aggregate', async (request, reply) => {
    const parsed = aggregateQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid query parameters',
        issues: parsed.error.issues,
      });
    }
    const { bucket, from, to } = parsed.data;

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
      return reply.code(400).send({ error: 'Invalid from/to datetime' });
    }
    if (fromDate >= toDate) {
      return reply.code(400).send({ error: 'from must be strictly before to' });
    }

    try {
      const result = await EnergyAggregateService.getAggregate({
        from: fromDate,
        to: toDate,
        bucket: bucket as EnergyBucket,
      });
      return reply.send(result);
    } catch (err) {
      server.log.error(
        { name: 'EnergyAggregate', err: (err as Error).message },
        'getAggregate failed',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  /**
   * GET /api/energy/cycles
   *
   * Stubbed in Phase 19 — Phase 21 wires the per-cycle attribution
   * surface that consumes cycle_records rows populated by the Plan
   * 19-06 cycle persister and the Plan 19-07 attribution classifier.
   */
  server.get('/api/energy/cycles', async (_request, reply) =>
    reply
      .code(503)
      .send({ error: 'Not Implemented — Phase 21 wires this' }),
  );
};
