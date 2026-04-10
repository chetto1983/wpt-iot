import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { cloudMqttConfig } from '../db/schema/cloudMqtt.js';
import type { CloudMqttConfigRow } from '../db/schema/cloudMqtt.js';

/**
 * Cloud MQTT / Sparkplug B config CRUD operations.
 * Single-row config table (id=1) storing gateway settings.
 */
export class CloudConfigService {
  /**
   * Ensure cloud_mqtt_config table exists and has a default row.
   */
  static async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cloud_mqtt_config (
        id SERIAL PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        group_id VARCHAR(255) NOT NULL DEFAULT 'WPT',
        edge_node_id VARCHAR(255) NOT NULL DEFAULT 'iot-box-01',
        broker_host VARCHAR(255) NOT NULL DEFAULT 'localhost',
        broker_port INTEGER NOT NULL DEFAULT 1883,
        username VARCHAR(255) NOT NULL DEFAULT 'cloud-uplink',
        password VARCHAR(255) NOT NULL DEFAULT 'cloud_uplink_pass',
        telemetry_interval_seconds INTEGER NOT NULL DEFAULT 30,
        publish_machine_data BOOLEAN NOT NULL DEFAULT true,
        publish_cycle_records BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await db.execute(
      sql`SELECT id FROM cloud_mqtt_config WHERE id = 1`,
    );

    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO cloud_mqtt_config (
          id, enabled, group_id, edge_node_id, broker_host, broker_port, username, password,
          telemetry_interval_seconds, publish_machine_data, publish_cycle_records
        ) VALUES (
          1, false, 'WPT', 'iot-box-01', 'localhost', 1883, 'cloud-uplink', 'cloud_uplink_pass',
          30, true, true
        )
      `);
    }
  }

  static async getConfig(): Promise<CloudMqttConfigRow> {
    const rows = await db
      .select()
      .from(cloudMqttConfig)
      .where(eq(cloudMqttConfig.id, 1));

    const row = rows[0];
    if (!row) {
      await CloudConfigService.ensureTable();
      const retry = await db
        .select()
        .from(cloudMqttConfig)
        .where(eq(cloudMqttConfig.id, 1));
      const retryRow = retry[0];
      if (!retryRow) {
        throw new Error('Failed to initialize cloud_mqtt_config row');
      }
      return retryRow;
    }

    return row;
  }

  static async updateConfig(
    updates: Partial<Omit<CloudMqttConfigRow, 'id' | 'updatedAt'>>,
  ): Promise<CloudMqttConfigRow> {
    const sanitized = { ...updates };
    if (sanitized.password === '') {
      delete sanitized.password;
    }

    const rows = await db
      .update(cloudMqttConfig)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(eq(cloudMqttConfig.id, 1))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('cloud_mqtt_config row not found');
    }
    return row;
  }
}
