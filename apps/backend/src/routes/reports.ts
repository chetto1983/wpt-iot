import type { FastifyPluginAsync } from 'fastify';
import { UserRole, CLIENT_VISIBLE_FIELDS, WPT_VISIBLE_FIELDS } from '@wpt/types';
import { requireAuth } from '../auth/authHooks.js';
import { ReportService } from '../services/reportService.js';
import { PdfService } from '../services/pdfService.js';
import { getFieldLabel } from '../i18n/fieldLabels.js';

/**
 * Machine data report endpoints (CSV + PDF).
 * All authenticated users can access; CLIENT gets limited columns.
 */
export const reportRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireAuth);

  /** GET /reports/machine — JSON preview (first 100 rows) */
  server.get('/reports/machine', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { from, to, cycle, lang } = parseReportQuery(query, request);

    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    const role = request.session.role as UserRole;
    const fields: readonly string[] =
      role === UserRole.CLIENT ? CLIENT_VISIBLE_FIELDS : WPT_VISIBLE_FIELDS;
    const allFields = ['timestamp', ...fields] as const;
    const headers = allFields.map((f) => getFieldLabel(f, lang));

    const rows = await ReportService.querySnapshots({ from, to, cycle });
    const preview = rows.slice(0, 100).map((row) => {
      const obj: Record<string, unknown> = {};
      for (const f of allFields) {
        const val = row[f];
        obj[f] = val instanceof Date ? val.toISOString() : val;
      }
      return obj;
    });

    return { rows: preview, total: rows.length, fields: allFields, headers };
  });

  /** GET /reports/machine/csv */
  server.get('/reports/machine/csv', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { from, to, cycle, lang } = parseReportQuery(query, request);

    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    const role = request.session.role as UserRole;
    const fields: readonly string[] =
      role === UserRole.CLIENT ? CLIENT_VISIBLE_FIELDS : WPT_VISIBLE_FIELDS;
    const allFields = ['timestamp', ...fields] as const;
    const headers = allFields.map((f) => getFieldLabel(f, lang));

    const rows = await ReportService.querySnapshots({
      from,
      to,
      cycle: cycle !== undefined ? cycle : undefined,
    });

    if (rows.length === 0) {
      return reply
        .code(404)
        .send({ error: 'No data found for the specified range' });
    }

    const csv = ReportService.toCSV(rows, allFields, headers);
    const filename = `machine-report-${formatDateForFile(from)}-${formatDateForFile(to)}.csv`;

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });

  /** GET /reports/machine/pdf */
  server.get('/reports/machine/pdf', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { from, to, cycle, lang } = parseReportQuery(query, request);

    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    const role = request.session.role as UserRole;
    const fields: readonly string[] =
      role === UserRole.CLIENT ? CLIENT_VISIBLE_FIELDS : WPT_VISIBLE_FIELDS;
    const allFields = ['timestamp', ...fields] as const;
    const headers = allFields.map((f) => getFieldLabel(f, lang));

    const rows = await ReportService.querySnapshots({
      from,
      to,
      cycle: cycle !== undefined ? cycle : undefined,
    });

    if (rows.length === 0) {
      return reply
        .code(404)
        .send({ error: 'No data found for the specified range' });
    }

    const title =
      lang === 'it' ? 'Report Dati Macchina' : 'Machine Data Report';
    const pdf = await PdfService.generatePdf(rows, allFields, headers, title);
    const filename = `machine-report-${formatDateForFile(from)}-${formatDateForFile(to)}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedReportQuery {
  from: Date;
  to: Date;
  cycle: number | undefined;
  lang: 'it' | 'en';
}

function parseReportQuery(
  query: Record<string, string>,
  request: { session: { language?: 'it' | 'en' } },
): ParsedReportQuery {
  const from = new Date(query.from ?? '');
  const to = new Date(query.to ?? '');

  const cycleRaw = query.cycle ? parseInt(query.cycle, 10) : undefined;
  const cycle = cycleRaw !== undefined && !isNaN(cycleRaw) ? cycleRaw : undefined;

  const lang = (query.lang ?? request.session.language ?? 'it') as
    | 'it'
    | 'en';

  return { from, to, cycle, lang };
}

function formatDateForFile(d: Date): string {
  return d.toISOString().split('T')[0]!;
}
