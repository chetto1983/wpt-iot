import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mqttConfig } from '../db/schema/mqtt.js';
import type { IMqttConfig } from '@wpt/types';

/**
 * MQTT config CRUD operations.
 * Single-row config table (id=1) storing gateway settings.
 *
 * Uses direct SQL for table creation to avoid drizzle-kit push
 * conflicts with TimescaleDB continuous aggregates.
 */
export class MqttConfigService {
  /**
   * Ensure mqtt_config table exists and has a default row.
   * Called once at startup before any config reads.
   */
  static async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mqtt_config (
        id SERIAL PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        broker_host VARCHAR(255) NOT NULL DEFAULT 'localhost',
        broker_port INTEGER NOT NULL DEFAULT 1883,
        site_id VARCHAR(100) NOT NULL DEFAULT 'site-01',
        machine_id VARCHAR(100) NOT NULL DEFAULT 'wpt40-001',
        publish_machine BOOLEAN NOT NULL DEFAULT true,
        publish_alarms BOOLEAN NOT NULL DEFAULT true,
        publish_rfid BOOLEAN NOT NULL DEFAULT false,
        publish_jobs BOOLEAN NOT NULL DEFAULT false,
        use_tls BOOLEAN NOT NULL DEFAULT false,
        ca_cert VARCHAR(10000),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Migration: add TLS columns to existing tables that lack them
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS use_tls BOOLEAN NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS ca_cert VARCHAR(10000)
    `);

    const existing = await db.execute(
      sql`SELECT id FROM mqtt_config WHERE id = 1`,
    );

    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO mqtt_config (
          id, enabled, broker_host, broker_port, site_id, machine_id,
          publish_machine, publish_alarms, publish_rfid, publish_jobs,
          use_tls, ca_cert
        ) VALUES (
          1, false, 'localhost', 1883, 'site-01', 'wpt40-001',
          true, true, false, false,
          false, NULL
        )
      `);
    }
  }

  /**
   * Get the current MQTT configuration.
   * If no row exists, ensures the table and retries.
   */
  static async getConfig(): Promise<IMqttConfig> {
    const rows = await db
      .select()
      .from(mqttConfig)
      .where(eq(mqttConfig.id, 1));

    const row = rows[0];
    if (!row) {
      await MqttConfigService.ensureTable();
      const retry = await db
        .select()
        .from(mqttConfig)
        .where(eq(mqttConfig.id, 1));
      const retryRow = retry[0];
      if (!retryRow) {
        throw new Error('Failed to initialize mqtt_config row');
      }
      return retryRow;
    }

    return row;
  }

  /**
   * Update MQTT configuration fields.
   * Only provided fields are updated; updatedAt is always refreshed.
   */
  static async updateConfig(
    updates: Partial<Omit<IMqttConfig, 'id' | 'updatedAt'>>,
  ): Promise<IMqttConfig> {
    const rows = await db
      .update(mqttConfig)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mqttConfig.id, 1))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('mqtt_config row not found');
    }
    return row;
  }
}
