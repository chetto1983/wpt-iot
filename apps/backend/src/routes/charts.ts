import type { FastifyPluginAsync } from 'fastify';
import { UserRole, CLIENT_VISIBLE_FIELDS, WPT_VISIBLE_FIELDS } from '@wpt/types';
import { requireAuth } from '../auth/authHooks.js';
import { ChartService } from '../services/chartService.js';

/**
 * Chart data endpoints.
 * All authenticated users can access; CLIENT sees fewer fields.
 */
export const chartRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireAuth);

  /** GET /charts/data — time-series chart data with auto-resolution */
  server.get('/charts/data', async (request, reply) => {
    const query = request.query as Record<string, string | string[]>;

    // Parse dates
    const from = new Date(query.from as string);
    const to = new Date(query.to as string);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid date range' });
    }

    // Parse fields: accept both `fields=a,b,c` and `fields[]=a&fields[]=b`
    let requestedFields: string[];
    if (Array.isArray(query.fields)) {
      requestedFields = query.fields as string[];
    } else if (typeof query.fields === 'string') {
      requestedFields = (query.fields as string).split(',').filter(Boolean);
    } else {
      requestedFields = [];
    }

    if (requestedFields.length === 0) {
      return reply.code(400).send({ error: 'No fields selected' });
    }

    // Role-based field filtering (defense in depth per Research Pitfall 6)
    const role = request.session.role as UserRole;
    const allowedFields: readonly string[] =
      role === UserRole.CLIENT ? CLIENT_VISIBLE_FIELDS : WPT_VISIBLE_FIELDS;
    const fields = requestedFields.filter((f) =>
      (allowedFields as readonly string[]).includes(f),
    );

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'No valid fields for your role' });
    }

    const result = await ChartService.queryChartData({ from, to, fields });
    return result;
  });
};
