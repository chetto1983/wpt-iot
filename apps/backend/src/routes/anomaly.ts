import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod/v4';
import { UserRole } from '@wpt/types';
import {
  machineAnomalyService,
  MachineAnomalyEvaluationService,
  MachineAnomalyEventService,
  MachineAnomalyReplayService,
  MachineAnomalyScenarioService,
} from '../services/anomaly/index.js';
import { requireAuth, requireRole } from '../auth/authHooks.js';

const anomalySimulationSchema = z.object({
  scenario: z.enum(['temperature_spike', 'pressure_runaway', 'energy_drift', 'voltage_sag', 'pump_failure', 'water_leak', 'thermal_gradient']),
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

export const anomalyRoutes: FastifyPluginAsync = async (server) => {
  // Phase 39 CLEAN-01 — anomaly handlers extracted from energyRoutes.
  // Registered with scoped prefix `/api/energy/anomaly` in server.ts so
  // all inner routes use short paths (`/live`, `/events`, `/simulate`, ...).
  //
  // Registered BEFORE energyRoutes so the anomaly detector lifecycle
  // (loadState + start) completes before any energy/cycle consumer reads
  // anomaly state. Shadow detector (Phase 41) inherits this precedent.

  // C6: Restore detector state from disk before starting live tracking
  await machineAnomalyService.loadState(server.log);
  machineAnomalyService.start(server.log);

  server.addHook('onClose', async () => {
    machineAnomalyService.stop();
    // C6: Persist detector state to disk so baselines survive restarts
    await machineAnomalyService.saveState(server.log);
  });

  server.get('/live', { preHandler: requireAuth }, async (_request, reply) =>
    reply.send({
      tracking: machineAnomalyService.getTrackingStatus(),
      latest: machineAnomalyService.getLatest(),
    }),
  );

  server.get('/events', { preHandler: requireAuth }, async (request, reply) => {
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

  server.post('/simulate', { preHandler: requireAuth }, async (request, reply) => {
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

  server.post('/replay', { preHandler: requireAuth }, async (request, reply) => {
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

  server.post('/evaluate', { preHandler: requireAuth }, async (request, reply) => {
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

  server.patch('/events/:id/acknowledge', { preHandler: requireAuth }, async (request, reply) => {
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

  server.patch('/events/:id/resolve', { preHandler: requireAuth }, async (request, reply) => {
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

  server.delete('/events/:id', { preHandler: requireRole(UserRole.SUPER_ADMIN) }, async (request, reply) => {
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

  // ── C7: Feedback loop — threshold recalibration suggestions ───────────

  server.get('/feedback', { preHandler: requireAuth }, async (_request, reply) => {
    try {
      const stats = await MachineAnomalyEventService.getFeedbackStats();
      return reply.send(stats);
    } catch (err) {
      server.log.error({ name: 'AnomalyFeedback', err: (err as Error).message }, 'Feedback stats failed');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.patch('/thresholds', { preHandler: requireRole(UserRole.SUPER_ADMIN) }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const warning = typeof body?.warningThreshold === 'number' ? body.warningThreshold as number : undefined;
    const critical = typeof body?.criticalThreshold === 'number' ? body.criticalThreshold as number : undefined;
    if (warning === undefined && critical === undefined) {
      return reply.code(400).send({ error: 'Provide warningThreshold and/or criticalThreshold' });
    }
    if (warning !== undefined && (warning < 1 || warning > 10)) {
      return reply.code(400).send({ error: 'warningThreshold must be 1–10' });
    }
    if (critical !== undefined && (critical < 1 || critical > 15)) {
      return reply.code(400).send({ error: 'criticalThreshold must be 1–15' });
    }
    if (warning !== undefined && critical !== undefined && warning >= critical) {
      return reply.code(400).send({ error: 'warningThreshold must be less than criticalThreshold' });
    }
    // Update in-memory detector config — persisted on next shutdown via C6
    const config = machineAnomalyService.getDetectorConfig();
    if (warning !== undefined) config.warningThreshold = warning;
    if (critical !== undefined) config.criticalThreshold = critical;
    machineAnomalyService.updateDetectorConfig(config);
    server.log.info(
      { name: 'AnomalyFeedback', warningThreshold: warning, criticalThreshold: critical },
      'Detector thresholds updated',
    );
    return reply.send({ warningThreshold: config.warningThreshold, criticalThreshold: config.criticalThreshold });
  });

  // ── Alarm cross-correlation + PDF report ─────────────────────────────

  server.get('/correlations', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as Record<string, string>;
    const lag = Number(query['leadLagMinutes']) || 10;
    const limit = Number(query['limit']) || 20;
    try {
      const data = await MachineAnomalyEventService.getCorrelatedAlarms({ leadLagMinutes: lag, limit });
      return reply.send({ correlations: data });
    } catch (err) {
      server.log.error({ name: 'AnomalyCorrelation', err: (err as Error).message }, 'Correlation query failed');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  server.get('/report/pdf', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as Record<string, string>;
    const days = Number(query['days']) || 7;
    try {
      const data = await MachineAnomalyEventService.getReportData({ days });
      const { createDeterministicPdfBuffer } = await import('../services/pdf/index.js');
      const now = new Date();

      const tableBody = [
        [
          { text: 'Date', bold: true, fontSize: 9 },
          { text: 'Score', bold: true, fontSize: 9 },
          { text: 'Status', bold: true, fontSize: 9 },
          { text: 'Mode', bold: true, fontSize: 9 },
          { text: 'Top Driver', bold: true, fontSize: 9 },
          { text: 'Alarms ±10min', bold: true, fontSize: 9 },
        ],
        ...data.events.slice(0, 50).map((e) => {
          const corr = data.correlations.find((c) => c.event.id === e.id);
          const alarmCount = corr?.alarms.length ?? 0;
          return [
            { text: new Date(e.observedAt).toLocaleString('it-IT'), fontSize: 8 },
            { text: e.score.toFixed(2), fontSize: 8 },
            { text: e.status, fontSize: 8 },
            { text: e.modeKey, fontSize: 8 },
            { text: e.topContributors[0]?.feature ?? '—', fontSize: 8 },
            { text: alarmCount > 0 ? `${alarmCount} alarm(s)` : '—', fontSize: 8 },
          ];
        }),
      ];

      const pdf = await createDeterministicPdfBuffer(
        {
          pageSize: 'A4',
          pageMargins: [40, 60, 40, 50],
          content: [
            { text: 'WPT IoT — Anomaly Detection Report', fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
            { text: `Period: ${days} days (${new Date(data.period.from).toLocaleDateString('it-IT')} — ${now.toLocaleDateString('it-IT')})`, fontSize: 10, color: '#666', margin: [0, 0, 0, 15] },
            { text: 'Summary', fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
            {
              columns: [
                { text: `Total events: ${data.totalEvents}`, fontSize: 10 },
                { text: `TP rate: ${data.feedback.tpRate !== null ? (data.feedback.tpRate * 100).toFixed(0) + '%' : 'N/A'}`, fontSize: 10 },
                { text: `FP rate: ${data.feedback.fpRate !== null ? (data.feedback.fpRate * 100).toFixed(0) + '%' : 'N/A'}`, fontSize: 10 },
              ],
              margin: [0, 0, 0, 15],
            },
            ...(data.feedback.suggestion ? [{ text: `Suggestion: ${data.feedback.suggestion}`, fontSize: 10, color: '#b45309', margin: [0, 0, 0, 15] as [number, number, number, number] }] : []),
            { text: 'Events', fontSize: 14, bold: true, margin: [0, 0, 0, 8] as [number, number, number, number] },
            {
              table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto'], body: tableBody },
              layout: 'lightHorizontalLines',
            },
          ],
          defaultStyle: { font: 'Roboto' },
        },
        {
          title: 'WPT IoT Anomaly Report',
          author: 'WPT Sistema IoT',
          subject: `Anomaly detection report — ${days}d`,
          creator: 'WPT IoT ML',
          producer: 'pdfmake',
          creationDate: now,
          modDate: now,
        },
      );

      const filename = `anomaly-report-${days}d-${now.toISOString().slice(0, 10)}.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(pdf);
    } catch (err) {
      server.log.error({ name: 'AnomalyPdf', err: (err as Error).message }, 'PDF generation failed');
      return reply.code(500).send({ error: 'PDF generation failed' });
    }
  });
};
