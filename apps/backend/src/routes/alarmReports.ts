import type { FastifyPluginAsync } from 'fastify';
import { UserRole } from '@wpt/types';
import { requireRole } from '../auth/authHooks.js';
import { ReportService } from '../services/reportService.js';
import { PdfService } from '../services/pdfService.js';
import { getAlarmFieldLabels } from '../i18n/fieldLabels.js';

const ALARM_EXPORT_FIELDS = [
  'alarmCode',
  'description',
  'activatedAt',
  'resetAt',
  'duration',
] as const;

/**
 * Alarm report endpoints (list + CSV + PDF).
 * CLIENT role is blocked per ALM-05.
 */
export const alarmReportRoutes: FastifyPluginAsync = async (server) => {
  server.addHook(
    'preHandler',
    requireRole(UserRole.WPT, UserRole.SUPER_ADMIN),
  );

  /** GET /reports/alarms — JSON for preview table */
  server.get('/reports/alarms', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { from, to, status, lang } = parseAlarmQuery(query, request);

    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    const rows = await ReportService.queryAlarmEvents({ from, to, status });
    const events = rows.map((row) =>
      ReportService.formatAlarmForExport(row, lang),
    );

    const activeCount = rows.filter((r) => r.resetAt === null).length;

    return {
      events,
      total: events.length,
      active: activeCount,
      resolved: events.length - activeCount,
    };
  });

  /** GET /reports/alarms/csv */
  server.get('/reports/alarms/csv', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { from, to, status, lang } = parseAlarmQuery(query, request);

    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    const rows = await ReportService.queryAlarmEvents({ from, to, status });
    const formatted = rows.map((row) =>
      ReportService.formatAlarmForExport(row, lang),
    );

    if (formatted.length === 0) {
      return reply
        .code(404)
        .send({ error: 'No alarm events found for the specified range' });
    }

    const headers = getAlarmFieldLabels(lang);
    const csv = ReportService.toCSV(
      formatted as Record<string, unknown>[],
      ALARM_EXPORT_FIELDS as unknown as readonly string[],
      headers,
    );
    const filename = `alarm-report-${formatDateForFile(from)}-${formatDateForFile(to)}.csv`;

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });

  /** GET /reports/alarms/pdf */
  server.get('/reports/alarms/pdf', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { from, to, status, lang } = parseAlarmQuery(query, request);

    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    const rows = await ReportService.queryAlarmEvents({ from, to, status });
    const formatted = rows.map((row) =>
      ReportService.formatAlarmForExport(row, lang),
    );

    if (formatted.length === 0) {
      return reply
        .code(404)
        .send({ error: 'No alarm events found for the specified range' });
    }

    const headers = getAlarmFieldLabels(lang);
    const title = lang === 'it' ? 'Storico Allarmi' : 'Alarm History';
    const pdf = await PdfService.generatePdf(
      formatted as Record<string, unknown>[],
      ALARM_EXPORT_FIELDS as unknown as readonly string[],
      headers,
      title,
    );
    const filename = `alarm-report-${formatDateForFile(from)}-${formatDateForFile(to)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedAlarmQuery {
  from: Date;
  to: Date;
  status: 'all' | 'active' | 'resolved';
  lang: 'it' | 'en';
}

function parseAlarmQuery(
  query: Record<string, string>,
  request: { session: { language?: 'it' | 'en' } },
): ParsedAlarmQuery {
  const from = new Date(query.from ?? '');
  const to = new Date(query.to ?? '');

  const statusRaw = query.status as string | undefined;
  const status: 'all' | 'active' | 'resolved' =
    statusRaw === 'active' || statusRaw === 'resolved' ? statusRaw : 'all';

  const lang = (query.lang ?? request.session.language ?? 'it') as
    | 'it'
    | 'en';

  return { from, to, status, lang };
}

function formatDateForFile(d: Date): string {
  return d.toISOString().split('T')[0]!;
}
