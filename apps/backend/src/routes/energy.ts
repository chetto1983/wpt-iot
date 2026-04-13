import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { EnergyAggregateService } from '../services/energyAggregateService.js';
import { EnergyAttributionService } from '../services/energyAttributionService.js';
import { machineAnomalyService } from '../services/machineAnomalyService.js';
import { MachineAnomalyEvaluationService } from '../services/machineAnomalyEvaluationService.js';
import { MachineAnomalyEventService } from '../services/machineAnomalyEventService.js';
import { MachineAnomalyReplayService } from '../services/machineAnomalyReplayService.js';
import { MachineAnomalyScenarioService } from '../services/machineAnomalyScenarioService.js';
import {
  BaselineOverlapError,
  BaselinePredatesDataError,
  BaselineTooShortError,
  EnergyBaselineService,
  MeasurementTooShortError,
  NoActiveBaselineError,
} from '../services/energyBaselineService.js';
import { startV03CycleTracker } from '../persistence/v03CycleTracker.js';
import { startCyclePersister } from '../persistence/cyclePersister.js';
import {
  BaselineLockRequestSchema,
  EnergyConfigUpdateSchema,
  EnergyCyclesQuerySchema,
  EnergyDashboardSummaryQuerySchema,
  EnergyPdfReportQuerySchema,
  EnergyReconciliationQuerySchema,
  SavingsQuerySchema,
  type IEnergyAdminConfigResponse,
  type EnergyBucket,
  UserRole,
} from '@wpt/types';
import { requireAuth, requireRole } from '../auth/authHooks.js';
import { EnergyDashboardService } from '../services/energyDashboardService.js';
import { EnergyConfigService } from '../services/energyConfigService.js';
import { EnergyPdfService } from '../services/energyPdfService.js';

/**
 * /api/energy/* route plugin — Phase 19 Plan 19-10 scaffold.
 *
 * Shipped in Plan 19-10:
 *   GET /api/energy/aggregate  — calls EnergyAggregateService.getAggregate
 *   GET /api/energy/cycles     — 503 stub (Phase 21 wires it)
 *
 * Plan 19-06 (cycle persister) will extend THIS file with:
 *   - startV03CycleTracker(server.log)  registration in onReady
 *   - startCyclePersister(server.log)   registration in onReady
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

const anomalySimulationSchema = z.object({
  scenario: z.enum(['temperature_spike', 'pressure_runaway', 'energy_drift']),
  warmupSamples: z.number().int().min(10).max(500).optional(),
  scenarioSamples: z.number().int().min(1).max(200).optional(),
});

const anomalyReplaySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  maxRows: z.number().int().min(100).max(50000).optional(),
  topN: z.number().int().min(1).max(100).optional(),
});

const anomalyEvaluationSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  maxRows: z.number().int().min(100).max(50000).optional(),
  topN: z.number().int().min(1).max(100).optional(),
  alarmLeadMinutes: z.number().int().min(0).max(120).optional(),
  alarmLagMinutes: z.number().int().min(0).max(120).optional(),
});

const anomalyEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  flaggedOnly: z
    .union([z.literal('0'), z.literal('1')])
    .optional(),
});

const anomalyResolveSchema = z.object({
  status: z.enum(['CONFIRMED', 'DISMISSED']),
  note: z.string().max(500).optional(),
  category: z.enum(['TRUE_POSITIVE', 'FALSE_POSITIVE', 'PLANNED_MAINTENANCE', 'SENSOR_FAULT']).optional(),
});

export const energyRoutes: FastifyPluginAsync = async (server) => {
  // ── Plan 19-06: lifecycle wiring (Pattern 3 from RESEARCH.md) ────
  // The Fastify route plugin body is the start-function call site for
  // cycle-closed FSM tracking and per-cycle persistence:
  //
  //   1. startV03CycleTracker — subscribes to dataHub.onMachineData,
  //                             watches Cycle_Status (S1_I_DATO_71) for
  //                             rising edge transitions (0->1 start,
  //                             1->{2,3,4} end); emits cycle:closed with
  //                             full 14-field payload including energy/water
  //                             deltas and V03 cycle status label.
  //
  //   2. startCyclePersister  — subscribes to dataHub.onCycleClosed and
  //                             calls EnergyAttributionService
  //                             .insertCycleFromEvent which is idempotent
  //                             on (reset_epoch, cycle_number) per
  //                             ENRG-03/04.
  //
  //   3. 5-minute backfill    — every 5 minutes, scan machine_snapshots
  //                             for completedCycles increments in the
  //                             last BACKFILL_WINDOW_MS and insert any
  //                             rows still missing from cycle_records.
  //                             Safety net for cycles missed by the live
  //                             path (e.g. after a backend restart).
  //                             Idempotency: insertCycleFromEvent skips
  //                             rows that already exist, so live +
  //                             backfill paths are race-safe.
  //
  // onClose cleanup clears the interval so vitest processes don't leak.
  // ─────────────────────────────────────────────────────────────────
  startV03CycleTracker(server.log);
  startCyclePersister(server.log);
  // C6: Restore detector state from disk before starting live tracking
  await machineAnomalyService.loadState(server.log);
  machineAnomalyService.start(server.log);

  const BACKFILL_INTERVAL_MS = 5 * 60 * 1000;
  const BACKFILL_WINDOW_MS = 15 * 60 * 1000;
  const backfillInterval: NodeJS.Timeout = setInterval(() => {
    void (async () => {
      try {
        const inserted =
          await EnergyAttributionService.detectAndPersistClosedCycles(
            { since: new Date(Date.now() - BACKFILL_WINDOW_MS) },
            server.log,
          );
        if (inserted > 0) {
          server.log.info(
            { name: 'CycleBackfill', inserted },
            'Backfill scan inserted rows',
          );
        }
      } catch (err) {
        server.log.error(
          { name: 'CycleBackfill', err: (err as Error).message },
          'Backfill scan failed',
        );
      }
    })();
  }, BACKFILL_INTERVAL_MS);

  server.addHook('onClose', async () => {
    clearInterval(backfillInterval);
    machineAnomalyService.stop();
    // C6: Persist detector state to disk so baselines survive restarts
    await machineAnomalyService.saveState(server.log);
  });

  // =========================================================================
  // Phase 20 ENBL-07 — startup baseline data-preservation gate.
  //
  // Runs AFTER EnergyBaselineService.ensureSchema() (fired from index.ts
  // before server.listen()), so by onReady time both tables exist.
  //
  // If the active baseline's period_from predates the oldest available
  // energy_1d bucket, log fatal AND throw — but the hook SWALLOWS the
  // BaselinePredatesDataError so the backend still boots. /api/energy/savings
  // will return 422 BASELINE_PREDATES_DATA for that baseline until a new one
  // is locked. First-boot (no active baseline) is the null-return path.
  // =========================================================================
  server.addHook('onReady', async () => {
    try {
      const active = await EnergyBaselineService.getActiveBaseline();
      if (!active) return; // no baseline yet — first-boot path
      await EnergyBaselineService.validateOldestDataAvailability(active, server.log);
    } catch (err) {
      if (err instanceof BaselinePredatesDataError) {
        // The .fatal() log already fired inside validateOldestDataAvailability.
        // Swallow so the backend still boots.
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // Phase 20 — baseline error-to-HTTP mapper.
  //
  // D-10: 422 for the four validation classes, 404 for NoActiveBaselineError
  // (RESEARCH Open Question 1), 500 for unknown.
  //
  // BaselineTooShortError carries `details.reason` discriminator
  // ('window_too_short' | 'period_from_future' | 'no_production') so the
  // frontend can switch on `body.error.details.reason` for distinct messages.
  // The `err.details ?? {}` pass-through preserves it.
  // =========================================================================
  function mapBaselineErrorToResponse(
    err: Error,
  ): { status: number; body: unknown } {
    if (
      err instanceof BaselineOverlapError ||
      err instanceof MeasurementTooShortError ||
      err instanceof BaselineTooShortError ||
      err instanceof BaselinePredatesDataError
    ) {
      return {
        status: 422,
        body: {
          error: {
            code: err.code,
            message: err.message,
            details: err.details ?? {},
          },
        },
      };
    }
    if (err instanceof NoActiveBaselineError) {
      return {
        status: 404,
        body: {
          error: {
            code: err.code,
            message: err.message,
          },
        },
      };
    }
    // WR-02: normalize 500 branch to the same { error: { code, message } }
    // envelope used by 422/404 so frontend consumers can switch on
    // body.error.code without a TypeError on a bare-string .code access.
    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
        },
      },
    };
  }

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
  server.get('/energy/aggregate', { preHandler: requireAuth }, async (request, reply) => {
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

  server.get('/energy/config', { preHandler: requireRole(UserRole.SUPER_ADMIN) }, async (_request, reply) => {
    try {
      const [config, activePeriod] = await Promise.all([
        EnergyConfigService.getConfig(),
        EnergyConfigService.getActivePeriod(new Date()),
      ]);
      const payload: IEnergyAdminConfigResponse = {
        config,
        activePeriod,
      };
      return reply.send(payload);
    } catch (err) {
      server.log.error(
        { name: 'EnergyConfig', err: (err as Error).message },
        'get energy config failed',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.put('/energy/config', { preHandler: requireRole(UserRole.SUPER_ADMIN) }, async (request, reply) => {
    const parsed = EnergyConfigUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    try {
      const data = parsed.data;
      const effectiveFrom = new Date(data.effectiveFrom);

      const config = await EnergyConfigService.updateConfig({
        customerName: data.customerName,
        machineSerial: data.machineSerial,
        machineModel: data.machineModel,
        installSite: data.installSite,
        cosphi: data.cosphi,
        shiftStartHour: data.shiftStartHour,
      });

      await EnergyConfigService.insertNewPeriod({
        validFrom: effectiveFrom,
        validTo: null,
        emissionFactorKgPerKwh: data.emissionFactorKgPerKwh,
        emissionFactorYear: data.emissionFactorYear,
        emissionFactorSource: data.emissionFactorSource,
        tariffMode: data.tariffMode,
        tariffSingleEurPerKwh: data.tariffSingleEurPerKwh,
        tariffBandsJson: data.tariffBandsJson,
        customHolidays: [],
      });

      const activePeriod = await EnergyConfigService.getActivePeriod(effectiveFrom);
      const payload: IEnergyAdminConfigResponse = {
        config,
        activePeriod,
      };
      return reply.send(payload);
    } catch (err) {
      server.log.error(
        { name: 'EnergyConfig', err: (err as Error).message },
        'update energy config failed',
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
  server.get('/energy/dashboard', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = EnergyDashboardSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }

    try {
      return reply.send(
        await EnergyDashboardService.getDashboardSummary({
          from: new Date(parsed.data.from),
          to: new Date(parsed.data.to),
          role: request.session.role as UserRole,
        }),
      );
    } catch (err) {
      server.log.error(
        { name: 'EnergyDashboard', err: (err as Error).message },
        'getDashboardSummary failed',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.get('/energy/cycles', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = EnergyCyclesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }

    try {
      return reply.send(
        await EnergyDashboardService.getCycles({
          from: new Date(parsed.data.from),
          to: new Date(parsed.data.to),
          limit: parsed.data.limit,
          role: request.session.role as UserRole,
        }),
      );
    } catch (err) {
      server.log.error(
        { name: 'EnergyDashboard', err: (err as Error).message },
        'getCycles failed',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.get(
    '/energy/reconciliation',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = EnergyReconciliationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid query parameters', issues: parsed.error.issues });
      }

      try {
        return reply.send(
          await EnergyDashboardService.getReconciliation({
            from: new Date(parsed.data.from),
            to: new Date(parsed.data.to),
            role: request.session.role as UserRole,
          }),
        );
      } catch (err) {
        server.log.error(
          { name: 'EnergyDashboard', err: (err as Error).message },
          'getReconciliation failed',
        );
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  server.get('/energy/cycles-legacy-stub', async (_request, reply) =>
    reply
      .code(503)
      .send({ error: 'Not Implemented — Phase 21 wires this' }),
  );

  server.get('/energy/anomaly/live', { preHandler: requireAuth }, async (_request, reply) =>
    reply.send({
      tracking: machineAnomalyService.getTrackingStatus(),
      latest: machineAnomalyService.getLatest(),
    }),
  );

  server.get('/energy/anomaly/events', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = anomalyEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }

    try {
      const events = await MachineAnomalyEventService.listRecent({
        limit: parsed.data.limit,
        flaggedOnly: parsed.data.flaggedOnly === '1',
      });
      return reply.send({ events });
    } catch (err) {
      server.log.error(
        { name: 'MachineAnomalyEvents', err: (err as Error).message },
        'Failed to load anomaly events',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.post('/energy/anomaly/simulate', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = anomalySimulationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    return reply.send(
      MachineAnomalyScenarioService.run({
        scenario: parsed.data.scenario,
        warmupSamples: parsed.data.warmupSamples,
        scenarioSamples: parsed.data.scenarioSamples,
      }),
    );
  });

  server.post('/energy/anomaly/replay', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = anomalyReplaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid from/to datetime' });
    }
    if (from >= to) {
      return reply.code(400).send({ error: 'from must be strictly before to' });
    }

    try {
      return reply.send(
        await MachineAnomalyReplayService.replay({
          from,
          to,
          maxRows: parsed.data.maxRows,
          topN: parsed.data.topN,
        }),
      );
    } catch (err) {
      server.log.error(
        { name: 'MachineAnomalyReplay', err: (err as Error).message },
        'Historical anomaly replay failed',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.post('/energy/anomaly/evaluate', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = anomalyEvaluationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid from/to datetime' });
    }
    if (from >= to) {
      return reply.code(400).send({ error: 'from must be strictly before to' });
    }

    try {
      return reply.send(
        await MachineAnomalyEvaluationService.evaluate({
          from,
          to,
          maxRows: parsed.data.maxRows,
          topN: parsed.data.topN,
          alarmLeadMinutes: parsed.data.alarmLeadMinutes,
          alarmLagMinutes: parsed.data.alarmLagMinutes,
        }),
      );
    } catch (err) {
      server.log.error(
        { name: 'MachineAnomalyEvaluate', err: (err as Error).message },
        'Historical anomaly evaluation failed',
      );
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // ── C1: Event lifecycle routes ────────────────────────────────────────

  server.patch('/energy/anomaly/events/:id/acknowledge', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isFinite(eventId) || eventId < 1) {
      return reply.code(400).send({ error: 'Invalid event id' });
    }
    try {
      const updated = await MachineAnomalyEventService.acknowledgeEvent(
        eventId,
        request.session.username as string,
      );
      if (!updated) {
        return reply.code(404).send({ error: 'Event not found or not in OPEN status' });
      }
      return reply.send({ event: updated });
    } catch (err) {
      server.log.error({ name: 'AnomalyLifecycle', err: (err as Error).message }, 'Acknowledge failed');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.patch('/energy/anomaly/events/:id/resolve', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isFinite(eventId) || eventId < 1) {
      return reply.code(400).send({ error: 'Invalid event id' });
    }
    const parsed = anomalyResolveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    try {
      const updated = await MachineAnomalyEventService.resolveEvent(
        eventId,
        request.session.username as string,
        parsed.data,
      );
      if (!updated) {
        return reply.code(404).send({ error: 'Event not found or already resolved' });
      }
      return reply.send({ event: updated });
    } catch (err) {
      server.log.error({ name: 'AnomalyLifecycle', err: (err as Error).message }, 'Resolve failed');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.delete('/energy/anomaly/events/:id', { preHandler: requireRole(UserRole.SUPER_ADMIN) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const eventId = Number(id);
    if (!Number.isFinite(eventId) || eventId < 1) {
      return reply.code(400).send({ error: 'Invalid event id' });
    }
    try {
      const deleted = await MachineAnomalyEventService.deleteEvent(eventId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      return reply.send({ deleted: true });
    } catch (err) {
      server.log.error({ name: 'AnomalyLifecycle', err: (err as Error).message }, 'Delete failed');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // =========================================================================
  // Phase 20 — POST /api/energy/baseline/lock
  //
  // Insert a new baseline row + freeze evidence snapshot. No UPDATE/PUT/PATCH.
  // =========================================================================
  server.post('/energy/baseline/lock', { preHandler: requireRole(UserRole.SUPER_ADMIN) }, async (request, reply) => {
    const parsed = BaselineLockRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid request body', issues: parsed.error.issues });
    }
    try {
      const result = await EnergyBaselineService.lockBaseline({
        label: parsed.data.label,
        periodFrom: new Date(parsed.data.periodFrom),
        periodTo: new Date(parsed.data.periodTo),
        justification: parsed.data.justification,
        normalizationVariables: parsed.data.normalizationVariables,
      });
      server.log.info(
        {
          name: 'EnergyBaseline',
          baselineId: result.baseline.baselineId,
          warnings: result.warnings,
        },
        'baseline_locked',
      );
      return reply.code(201).send(result);
    } catch (err) {
      const mapped = mapBaselineErrorToResponse(err as Error);
      if (mapped.status >= 500) {
        server.log.error(
          { name: 'EnergyBaseline', err: (err as Error).message },
          'lockBaseline failed',
        );
      } else {
        server.log.warn(
          { name: 'EnergyBaseline', err: (err as Error).message },
          'lockBaseline rejected',
        );
      }
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  // =========================================================================
  // Phase 20 — POST /api/energy/baseline/:id/retire
  //
  // Sets retired_at = NOW(). 204 on success, 404 if id not found.
  // =========================================================================
  server.post<{ Params: { id: string } }>(
    '/energy/baseline/:id/retire',
    { preHandler: requireRole(UserRole.SUPER_ADMIN) },
    async (request, reply) => {
      const baselineId = Number(request.params.id);
      if (!Number.isFinite(baselineId) || baselineId <= 0) {
        return reply.code(400).send({ error: 'Invalid baseline id' });
      }
      const existing = await EnergyBaselineService.getBaselineById(baselineId);
      if (!existing) {
        return reply.code(404).send({ error: 'Baseline not found' });
      }
      await EnergyBaselineService.retireBaseline(baselineId);
      server.log.info({ name: 'EnergyBaseline', baselineId }, 'baseline_retired');
      return reply.code(204).send();
    },
  );

  // =========================================================================
  // Phase 20 — GET /api/energy/savings
  //
  // D-04: default baseline resolution (max(locked_at) WHERE retired_at IS NULL)
  //       happens here, NOT in the service layer. 204 on no active baseline.
  // D-09: response shape frozen — ISavingsResponse (detail=0) or
  //       ISavingsDetailResponse (detail=1).
  // =========================================================================
  server.get('/energy/savings', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = SavingsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }
    const { from, to, baseline_id, detail } = parsed.data;

    // D-04: default baseline resolution at the route layer
    let baselineId: number;
    if (baseline_id != null) {
      const parsedId = Number(baseline_id);
      if (!Number.isFinite(parsedId) || parsedId <= 0) {
        return reply.code(400).send({ error: 'Invalid baseline_id' });
      }
      baselineId = parsedId;
    } else {
      const active = await EnergyBaselineService.getActiveBaseline();
      if (!active) {
        // No active baseline — Phase 21 widget switches on 204 to render
        // "Declare a baseline in /settings/energy to see savings"
        return reply.code(204).send();
      }
      baselineId = active.baselineId;
    }

    try {
      const result = await EnergyBaselineService.computeSavings({
        baselineId,
        measurementFrom: new Date(from),
        measurementTo: new Date(to),
        detail: detail === '1' ? 1 : 0,
      });
      return reply.send(result);
    } catch (err) {
      const mapped = mapBaselineErrorToResponse(err as Error);
      if (mapped.status >= 500) {
        server.log.error(
          { name: 'EnergyBaseline', err: (err as Error).message },
          'computeSavings failed',
        );
      }
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  server.post(
    '/energy/reports/iso50001/pdf',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = EnergyPdfReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid query parameters', issues: parsed.error.issues });
      }

      const { from, to, lang, baseline_id } = parsed.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid from/to datetime' });
      }
      if (fromDate >= toDate) {
        return reply.code(400).send({ error: 'from must be strictly before to' });
      }

        let baselineId: number | undefined;
        if (baseline_id != null) {
          const parsedId = Number(baseline_id);
          if (!Number.isInteger(parsedId) || parsedId <= 0) {
            return reply.code(400).send({ error: 'Invalid baseline_id' });
          }
          baselineId = parsedId;
        } else {
          const active = await EnergyBaselineService.getActiveBaseline();
          baselineId = active?.baselineId;
        }

        try {
          const pdf = await EnergyPdfService.generateIso50001Pdf({
            from: fromDate,
            to: toDate,
            lang,
            baselineId,
          });
          const filename =
            baselineId != null
              ? `energy-iso50001-baseline-${baselineId}-${from}-${to}-${lang}.pdf`
              : `energy-iso50001-${from}-${to}-${lang}.pdf`;

          return reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(pdf);
        } catch (err) {
          server.log.error(
            { name: 'EnergyPdfReport', err: (err as Error).message, baselineId },
          'generateIso50001Pdf failed',
        );
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
