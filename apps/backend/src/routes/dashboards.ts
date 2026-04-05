import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/authHooks.js';
import { DashboardService } from '../services/dashboardService.js';
import type { ChartType, IPanelConfig, ILayoutItem, IDashboardSettings } from '@wpt/types';

/**
 * Dashboard CRUD endpoints.
 * All routes require authentication; ownership is enforced per-query.
 */
export const dashboardRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('preHandler', requireAuth);

  // GET /dashboards -- list user's dashboards
  server.get('/dashboards', async (request) => {
    const userId = request.session.userId as number;
    return DashboardService.listByUser(userId);
  });

  // POST /dashboards -- create dashboard
  server.post('/dashboards', async (request, reply) => {
    const userId = request.session.userId as number;
    const { name } = request.body as { name: string };
    if (!name || name.length < 1 || name.length > 100) {
      return reply.code(400).send({ error: 'Name required (1-100 chars)' });
    }
    const dashboard = await DashboardService.create(userId, name);
    return reply.code(201).send(dashboard);
  });

  // GET /dashboards/:id -- get dashboard + panels
  server.get('/dashboards/:id', async (request, reply) => {
    const userId = request.session.userId as number;
    const { id } = request.params as { id: string };
    const result = await DashboardService.getById(Number(id), userId);
    if (!result) return reply.code(404).send({ error: 'Dashboard not found' });
    return result;
  });

  // PUT /dashboards/:id -- update dashboard
  server.put('/dashboards/:id', async (request, reply) => {
    const userId = request.session.userId as number;
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; layout?: ILayoutItem[]; settings?: IDashboardSettings };
    const updated = await DashboardService.update(Number(id), userId, body);
    if (!updated) return reply.code(404).send({ error: 'Dashboard not found' });
    return updated;
  });

  // DELETE /dashboards/:id -- delete dashboard
  server.delete('/dashboards/:id', async (request, reply) => {
    const userId = request.session.userId as number;
    const { id } = request.params as { id: string };
    const ok = await DashboardService.remove(Number(id), userId);
    if (!ok) return reply.code(404).send({ error: 'Dashboard not found' });
    return reply.code(204).send();
  });

  // POST /dashboards/:id/panels -- create panel
  server.post('/dashboards/:id/panels', async (request, reply) => {
    const userId = request.session.userId as number;
    const { id } = request.params as { id: string };
    const body = request.body as { panelKey: string; title: string; chartType: ChartType; config: IPanelConfig };
    const panel = await DashboardService.createPanel(Number(id), userId, body);
    if (!panel) return reply.code(404).send({ error: 'Dashboard not found' });
    return reply.code(201).send(panel);
  });

  // PUT /panels/:id -- update panel
  server.put('/panels/:id', async (request, reply) => {
    const userId = request.session.userId as number;
    const { id } = request.params as { id: string };
    const body = request.body as { title?: string; chartType?: ChartType; config?: IPanelConfig };
    const updated = await DashboardService.updatePanel(Number(id), userId, body);
    if (!updated) return reply.code(404).send({ error: 'Panel not found' });
    return updated;
  });

  // DELETE /panels/:id -- delete panel
  server.delete('/panels/:id', async (request, reply) => {
    const userId = request.session.userId as number;
    const { id } = request.params as { id: string };
    const ok = await DashboardService.removePanel(Number(id), userId);
    if (!ok) return reply.code(404).send({ error: 'Panel not found' });
    return reply.code(204).send();
  });
};
