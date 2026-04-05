import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dashboards, panels } from '../db/schema/dashboards.js';
import type { ILayoutItem, IDashboardSettings, IPanelConfig, ChartType } from '@wpt/types';

// ---------------------------------------------------------------------------
// DashboardService — static-only class (per project convention)
// ---------------------------------------------------------------------------

export class DashboardService {
  /** List all dashboards for a user, ordered by creation date. */
  static async listByUser(userId: number) {
    return db
      .select()
      .from(dashboards)
      .where(eq(dashboards.userId, userId))
      .orderBy(asc(dashboards.createdAt));
  }

  /** Get a single dashboard with all its panels. Returns null if not found or not owned. */
  static async getById(id: number, userId: number) {
    const rows = await db
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.userId, userId)));

    const dashboard = rows[0];
    if (!dashboard) return null;

    const panelRows = await db
      .select()
      .from(panels)
      .where(eq(panels.dashboardId, id))
      .orderBy(asc(panels.createdAt));

    return { dashboard, panels: panelRows };
  }

  /** Create a new dashboard with default settings. */
  static async create(userId: number, name: string) {
    const rows = await db
      .insert(dashboards)
      .values({ userId, name, isDefault: false, layout: [], settings: {} })
      .returning();

    return rows[0]!;
  }

  /** Update dashboard fields. Returns updated row or null if not found/owned. */
  static async update(
    id: number,
    userId: number,
    data: { name?: string; layout?: ILayoutItem[]; settings?: IDashboardSettings },
  ) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) set['name'] = data.name;
    if (data.layout !== undefined) set['layout'] = data.layout;
    if (data.settings !== undefined) set['settings'] = data.settings;

    const rows = await db
      .update(dashboards)
      .set(set)
      .where(and(eq(dashboards.id, id), eq(dashboards.userId, userId)))
      .returning();

    return rows[0] ?? null;
  }

  /** Delete a dashboard (panels cascade-delete). Returns true if deleted. */
  static async remove(id: number, userId: number): Promise<boolean> {
    const rows = await db
      .delete(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.userId, userId)))
      .returning({ id: dashboards.id });

    return rows.length > 0;
  }

  /** Create a panel within a dashboard. Verifies dashboard ownership first. */
  static async createPanel(
    dashboardId: number,
    userId: number,
    panel: { panelKey: string; title: string; chartType: ChartType; config: IPanelConfig },
  ) {
    // Verify dashboard belongs to user
    const owns = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), eq(dashboards.userId, userId)));

    if (owns.length === 0) return null;

    const rows = await db
      .insert(panels)
      .values({
        dashboardId,
        panelKey: panel.panelKey,
        title: panel.title,
        chartType: panel.chartType,
        config: panel.config,
      })
      .returning();

    return rows[0]!;
  }

  /** Update a panel. Verifies ownership via dashboard join. */
  static async updatePanel(
    panelId: number,
    userId: number,
    data: { title?: string; chartType?: ChartType; config?: IPanelConfig },
  ) {
    // Verify ownership: panel -> dashboard -> user
    const panelRows = await db
      .select({ id: panels.id, dashboardId: panels.dashboardId })
      .from(panels)
      .where(eq(panels.id, panelId));

    const panel = panelRows[0];
    if (!panel) return null;

    const ownerRows = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, panel.dashboardId), eq(dashboards.userId, userId)));

    if (ownerRows.length === 0) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) set['title'] = data.title;
    if (data.chartType !== undefined) set['chartType'] = data.chartType;
    if (data.config !== undefined) set['config'] = data.config;

    const rows = await db
      .update(panels)
      .set(set)
      .where(eq(panels.id, panelId))
      .returning();

    return rows[0] ?? null;
  }

  /** Delete a panel. Verifies ownership via dashboard join. */
  static async removePanel(panelId: number, userId: number): Promise<boolean> {
    // Verify ownership: panel -> dashboard -> user
    const panelRows = await db
      .select({ id: panels.id, dashboardId: panels.dashboardId })
      .from(panels)
      .where(eq(panels.id, panelId));

    const panel = panelRows[0];
    if (!panel) return false;

    const ownerRows = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(and(eq(dashboards.id, panel.dashboardId), eq(dashboards.userId, userId)));

    if (ownerRows.length === 0) return false;

    const rows = await db
      .delete(panels)
      .where(eq(panels.id, panelId))
      .returning({ id: panels.id });

    return rows.length > 0;
  }
}
