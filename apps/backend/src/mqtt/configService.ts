import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mqttConfig } from '../db/schema/mqtt.js';
import type { IMqttConfig, IMqttConfigPublic } from '@wpt/types';
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  loadEncryptionKey,
} from './secretCipher.js';

const LEGACY_DEV_PASSWORD = 'wpt_mqtt_dev_password';

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
        username VARCHAR(255) NOT NULL DEFAULT 'wpt-backend',
        password VARCHAR(512) NOT NULL DEFAULT '',
        site_id VARCHAR(100) NOT NULL DEFAULT 'site-01',
        machine_id VARCHAR(100) NOT NULL DEFAULT 'wpt40-001',
        use_tls BOOLEAN NOT NULL DEFAULT false,
        ca_cert VARCHAR(10000),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Migration: add columns to existing tables that lack them
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS use_tls BOOLEAN NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS ca_cert VARCHAR(10000)
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS username VARCHAR(255) NOT NULL DEFAULT 'wpt-backend'
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS password VARCHAR(512) NOT NULL DEFAULT ''
    `);
    // Password column was VARCHAR(255) before encryption-at-rest — widen to
    // fit the AES-256-GCM v1: envelope (iv:tag:ciphertext base64 ≈ 90 chars
    // per 32 plaintext chars, plus headroom).
    await db.execute(sql`
      ALTER TABLE mqtt_config ALTER COLUMN password TYPE VARCHAR(512)
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS sparkplug_group_id VARCHAR(255) NOT NULL DEFAULT 'WPT'
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS sparkplug_edge_node_id VARCHAR(255) NOT NULL DEFAULT 'iot-box-01'
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS publish_cycle_records BOOLEAN NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config ADD COLUMN IF NOT EXISTS telemetry_interval_seconds INTEGER NOT NULL DEFAULT 30
    `);

    // Phase 37 D-10 (dev-env destructive authorization 2026-04-14):
    // Drop legacy publish_* columns. The ad-hoc cloud publisher (publisher.ts) was
    // deleted in plan 37-01; the GET/PUT API contract narrowed in plan 37-03 task 1
    // no longer exposes these fields. This block reconciles existing dev databases
    // so no inert legacy state remains. site_id/machine_id columns stay (D-09 —
    // Local command namespace for the cmd/+/req local broker topics).
    await db.execute(sql`
      ALTER TABLE mqtt_config DROP COLUMN IF EXISTS publish_machine
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config DROP COLUMN IF EXISTS publish_alarms
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config DROP COLUMN IF EXISTS publish_rfid
    `);
    await db.execute(sql`
      ALTER TABLE mqtt_config DROP COLUMN IF EXISTS publish_jobs
    `);

    const existing = await db.execute(
      sql`SELECT id FROM mqtt_config WHERE id = 1`,
    );

    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO mqtt_config (
          id, enabled, broker_host, broker_port, username, password,
          site_id, machine_id,
          use_tls, ca_cert,
          sparkplug_group_id, sparkplug_edge_node_id, publish_cycle_records, telemetry_interval_seconds
        ) VALUES (
          1, false, 'localhost', 1883, 'wpt-backend', '',
          'site-01', 'wpt40-001',
          false, NULL,
          'WPT', 'iot-box-01', false, 30
        )
      `);
    }

    await MqttConfigService.migrateEncryptPassword();
  }

  /**
   * One-shot migration: if the stored password is not already encrypted,
   * encrypt it in place. The well-known legacy dev default
   * ('wpt_mqtt_dev_password') is wiped to empty AND the gateway is disabled —
   * every fresh DB shipped with that password in plaintext, so leaving it
   * encrypted would just preserve the known-credential hazard at rest.
   *
   * Runs every boot. After the first boot on a legacy DB the row is either
   * encrypted or wiped, and subsequent runs are no-ops.
   *
   * If the encryption key is missing AND the stored password is plaintext
   * AND non-empty AND not the legacy default, we log a loud warning and
   * leave the row alone — the backend will still boot, but the operator
   * must provision SECRETS_ENCRYPTION_KEY before we can protect the secret.
   */
  private static async migrateEncryptPassword(): Promise<void> {
    const rows = await db
      .select({ password: mqttConfig.password, enabled: mqttConfig.enabled })
      .from(mqttConfig)
      .where(eq(mqttConfig.id, 1));
    const row = rows[0];
    if (!row) return;

    if (row.password === '' || isEncrypted(row.password)) return;

    // Key check MUST come before the legacy-wipe path. Without a key we have
    // no safe destination for the secret — wiping would sever an existing
    // broker handshake (as happened on sacchi 2026-04-14 when the container
    // had no SECRETS_ENCRYPTION_KEY injected), and encrypting is impossible.
    // Leave the row untouched and log so the operator provisions the key.
    const key = loadEncryptionKey();
    if (!key) {
      // eslint-disable-next-line no-console
      console.warn(
        '[mqtt] mqtt_config.password is plaintext but SECRETS_ENCRYPTION_KEY is not set. The secret is stored unencrypted at rest. Provision SECRETS_ENCRYPTION_KEY and restart to migrate.',
      );
      return;
    }

    if (row.password === LEGACY_DEV_PASSWORD) {
      // Legacy default — encrypt in place so the existing broker handshake
      // keeps working, but log loudly so the operator rotates it to a fresh
      // credential via the admin UI (see CHANGELOG: v2.1.0 shipped the
      // encryption; the rotation is follow-up operator work).
      const encrypted = encryptSecret(LEGACY_DEV_PASSWORD, key);
      await db
        .update(mqttConfig)
        .set({ password: encrypted, updatedAt: new Date() })
        .where(eq(mqttConfig.id, 1));
      // eslint-disable-next-line no-console
      console.warn(
        '[mqtt] migrated legacy default password to AES-256-GCM at rest. ROTATE IT SOON — every deployment before this commit shipped the same plaintext default, so the credential is effectively public. Set a new password via /mqtt and re-key the broker with mosquitto_ctrl dynsec setClientPassword wpt-backend <new>.',
      );
      return;
    }

    const encrypted = encryptSecret(row.password, key);
    await db
      .update(mqttConfig)
      .set({ password: encrypted, updatedAt: new Date() })
      .where(eq(mqttConfig.id, 1));
    // eslint-disable-next-line no-console
    console.info('[mqtt] migrated mqtt_config.password from plaintext to AES-256-GCM.');
  }

  /**
   * Get the current MQTT configuration including the broker password as
   * plaintext (decrypted on read). Server-internal use only — never expose
   * this directly to API responses; use `getPublicConfig()` for that.
   *
   * If the stored password is encrypted we decrypt with SECRETS_ENCRYPTION_KEY.
   * If encrypted but no key is available, we throw — rather than silently
   * return ciphertext that would then be passed to `mqtt.connectAsync()` and
   * fail auth with a confusing error.
   *
   * Plaintext passwords (pre-migration, or missing-key state) pass through
   * unchanged; `migrateEncryptPassword()` logs a loud warning in that case.
   */
  static async getConfig(): Promise<IMqttConfig> {
    const rows = await db
      .select()
      .from(mqttConfig)
      .where(eq(mqttConfig.id, 1));

    let row = rows[0];
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
      row = retryRow;
    }

    if (row.password === '' || !isEncrypted(row.password)) {
      return row;
    }

    const key = loadEncryptionKey();
    if (!key) {
      throw new Error(
        'mqtt_config.password is encrypted but SECRETS_ENCRYPTION_KEY is not set — cannot decrypt.',
      );
    }
    return { ...row, password: decryptSecret(row.password, key) };
  }

  /**
   * Get the redacted MQTT config for API responses.
   * Strips the broker password and exposes only `passwordSet: boolean` so
   * the UI can decide whether the password input must be filled.
   */
  static async getPublicConfig(): Promise<IMqttConfigPublic> {
    const cfg = await MqttConfigService.getConfig();
    const { password, ...rest } = cfg;
    return { ...rest, passwordSet: password.length > 0 };
  }

  /**
   * Update MQTT configuration fields.
   * Only provided fields are updated; updatedAt is always refreshed.
   * An empty-string password is treated as "leave unchanged" so the UI can
   * round-trip the form without forcing the operator to retype credentials.
   */
  static async updateConfig(
    updates: Partial<Omit<IMqttConfig, 'id' | 'updatedAt'>>,
  ): Promise<IMqttConfig> {
    const sanitized: Partial<Omit<IMqttConfig, 'id' | 'updatedAt'>> = { ...updates };

    if (sanitized.password === '' || sanitized.password === undefined) {
      delete sanitized.password;
    } else {
      const key = loadEncryptionKey();
      if (!key) {
        throw new Error(
          'Cannot persist a new MQTT password: SECRETS_ENCRYPTION_KEY is not set. Provision the key and restart the backend before setting credentials.',
        );
      }
      sanitized.password = encryptSecret(sanitized.password, key);
    }

    const rows = await db
      .update(mqttConfig)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(eq(mqttConfig.id, 1))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('mqtt_config row not found');
    }
    // Return plaintext to the caller so downstream reconnect logic can use
    // it immediately without a round-trip through decrypt.
    if (sanitized.password !== undefined && updates.password) {
      return { ...row, password: updates.password };
    }
    // Password unchanged — decrypt the stored row for the caller.
    if (row.password !== '' && isEncrypted(row.password)) {
      const key = loadEncryptionKey();
      if (!key) {
        throw new Error(
          'mqtt_config.password is encrypted but SECRETS_ENCRYPTION_KEY is not set — cannot decrypt.',
        );
      }
      return { ...row, password: decryptSecret(row.password, key) };
    }
    return row;
  }
}
