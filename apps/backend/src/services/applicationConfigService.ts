import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  resolveTimezone,
  type IApplicationConfig,
} from '@wpt/types';
import { db } from '../db/index.js';
import { applicationConfig } from '../db/schema/appConfig.js';

let activeTimezone = DEFAULT_TIMEZONE;

/**
 * Global, DB-backed application settings.
 *
 * The timezone is also held in memory so date formatting remains synchronous
 * in report builders and hot paths. initialize() runs before Fastify starts;
 * updateConfig() refreshes the value immediately without a restart.
 */
export class ApplicationConfigService {
  static async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS application_config (
        id SERIAL PRIMARY KEY,
        timezone VARCHAR(100) NOT NULL DEFAULT 'Europe/Rome',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      INSERT INTO application_config (id, timezone)
      VALUES (1, 'Europe/Rome')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  static async initialize(): Promise<IApplicationConfig> {
    await ApplicationConfigService.ensureTable();
    const config = await ApplicationConfigService.getConfig();
    activeTimezone = resolveTimezone(config.timezone);
    return config;
  }

  static getTimezone(): string {
    return activeTimezone;
  }

  static async getConfig(): Promise<IApplicationConfig> {
    const rows = await db
      .select()
      .from(applicationConfig)
      .where(eq(applicationConfig.id, 1));
    const row = rows[0];
    if (!row) {
      await ApplicationConfigService.ensureTable();
      return ApplicationConfigService.getConfig();
    }
    return row;
  }

  static async updateConfig(timezone: string): Promise<IApplicationConfig> {
    if (!isValidTimezone(timezone)) {
      throw new Error('Invalid IANA timezone');
    }

    const rows = await db
      .update(applicationConfig)
      .set({ timezone, updatedAt: new Date() })
      .where(eq(applicationConfig.id, 1))
      .returning();
    const row = rows[0];
    if (!row) throw new Error('application_config row not found');

    activeTimezone = timezone;
    return row;
  }
}

