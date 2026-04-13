/**
 * Phase 24 — /api/cycles REST routes for Cycle Register page.
 *
 * Per CONTEXT D-05: Backend routes for cycle register page.
 * Per T-24-03a-01: Role-based access control — CLIENT can view,
 * SUPER_ADMIN can export.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  CyclesQuerySchema,
  CycleExportQuerySchema,
  UserRole,
  VALID_SORT_COLUMNS,
} from '@wpt/types';
import { CycleService } from '../services/cycleService.js';
import { CycleExportService } from '../services/cycleExportService.js';
import { requireAuth, requireRole } from '../auth/authHooks.js';

/**
 * Fastify plugin for /api/cycles routes.
 *
 * Endpoints:
 * - GET /api/cycles — paginated cycle records with filtering
 * - GET /api/cycles/export — CSV/PDF export (SUPER_ADMIN only)
 */
export const cycleRoutes: FastifyPluginAsync = async (server) => {
  /**
   * GET /api/cycles
   *
   * Query parameters (all optional except from/to):
   *   - from: ISO-8601 datetime (inclusive)
   *   - to: ISO-8601 datetime (exclusive)
   *   - page: page number (1-indexed, default: 1)
   *   - limit: items per page (default: 25, max: 100)
   *   - sort: column to sort by (default: 'startedAt')
   *   - order: 'asc' or 'desc' (default: 'desc')
   *
   * Access: CLIENT, WPT, SUPER_ADMIN (all authenticated roles)
   *
   * Per T-24-03a-02: Zod validation on query params prevents SQL injection.
   * Per T-24-03a-03: Server-side pagination with limit prevents DoS.
   */
  server.get(
    '/cycles',
    { preHandler: requireAuth },
    async (request, reply) => {
      // Validate query parameters with Zod
      const parsed = CyclesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        // Check if it's a date format issue
        const issues = parsed.error.issues;
        const hasDateIssue = issues.some(
          (i) => i.path.includes('from') || i.path.includes('to')
        );
        const hasSortIssue = issues.some(
          (i) => i.path.includes('sort')
        );

        if (hasDateIssue) {
          return reply.code(422).send({
            error: 'Invalid date format',
            issues,
          });
        }

        if (hasSortIssue) {
          return reply.code(422).send({
            error: 'Invalid sort column',
            issues,
          });
        }

        return reply.code(422).send({
          error: 'Invalid query parameters',
          issues,
        });
      }

      const { from, to, page, limit, sort, order } = parsed.data;

      // Parse and validate date range
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
        return reply.code(422).send({
          error: 'Invalid date format',
          message: 'from and to must be valid ISO datetime strings',
        });
      }

      // Per API contract: from must be strictly before to (half-open interval [from, to))
      if (fromDate >= toDate) {
        return reply.code(422).send({
          error: 'from must be before to',
          message: 'from date must be strictly before to date',
        });
      }

      // Validate sort column (belt-and-braces after Zod enum)
      if (!VALID_SORT_COLUMNS.includes(sort as typeof VALID_SORT_COLUMNS[number])) {
        return reply.code(422).send({
          error: 'Invalid sort column',
          message: `Sort must be one of: ${VALID_SORT_COLUMNS.join(', ')}`,
        });
      }

      try {
        const result = await CycleService.getCycles({
          from,
          to,
          page,
          limit,
          sort,
          order,
        });
        return reply.send(result);
      } catch (err) {
        server.log.error(
          { name: 'CycleService', err: (err as Error).message },
          'Failed to query cycle records',
        );
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );

  /**
   * GET /api/cycles/export
   *
   * Export cycle records as CSV or PDF.
   *
   * Query parameters:
   *   - from: ISO-8601 datetime (inclusive)
   *   - to: ISO-8601 datetime (exclusive)
   *   - format: 'csv' or 'pdf'
   *
   * Access: SUPER_ADMIN only (export capability restricted to admin)
   *
   * Per T-24-03a-01: Role-based access control restricts export to admin.
   */
  server.get(
    '/cycles/export',
    { preHandler: requireRole(UserRole.SUPER_ADMIN) },
    async (request, reply) => {
      // Validate query parameters with Zod
      const parsed = CycleExportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        // Check if it's a format issue
        const issues = parsed.error.issues;
        const hasFormatIssue = issues.some((i) => i.path.includes('format'));

        if (hasFormatIssue) {
          return reply.code(400).send({
            error: 'Invalid format parameter',
            issues,
          });
        }

        return reply.code(400).send({
          error: 'Invalid query parameters',
          issues,
        });
      }

      const { from, to, format } = parsed.data;

      // Parse and validate date range
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
        return reply.code(422).send({
          error: 'Invalid date format',
          message: 'from and to must be valid ISO datetime strings',
        });
      }

      if (fromDate >= toDate) {
        return reply.code(422).send({
          error: 'from must be before to',
          message: 'from date must be strictly before to date',
        });
      }

      try {
        // Generate filename
        const filename = CycleExportService.generateFilename(fromDate, format);

        if (format === 'csv') {
          const csv = await CycleExportService.generateCsv(fromDate, toDate);
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(csv);
        } else {
          const pdf = await CycleExportService.generatePdf(fromDate, toDate);
          return reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(pdf);
        }
      } catch (err) {
        server.log.error(
          { name: 'CycleExportService', err: (err as Error).message, format },
          'Failed to export cycle records',
        );
        return reply.code(500).send({ error: 'Internal error' });
      }
    },
  );
};
