import { pgTable, serial, varchar, integer, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import type { ILayoutItem, IDashboardSettings, IPanelConfig } from '@wpt/types';
import { authUsers } from './auth.js';

export const dashboards = pgTable('dashboards', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  layout: jsonb('layout').$type<ILayoutItem[]>().notNull().default([]),
  settings: jsonb('settings').$type<IDashboardSettings>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('dashboards_user_id_idx').on(table.userId),
]);

export const panels = pgTable('panels', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
  panelKey: varchar('panel_key', { length: 50 }).notNull(),
  title: varchar('title', { length: 100 }).notNull(),
  chartType: varchar('chart_type', { length: 20 }).notNull(),
  config: jsonb('config').$type<IPanelConfig>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('panels_dashboard_id_idx').on(table.dashboardId),
]);
