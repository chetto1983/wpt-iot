import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import type { IMachineSnapshot, IRfidUser, IJobData, IActiveAlarm } from '@wpt/types';
import { mqttTopic, MQTT_TOPIC_SUFFIXES } from '@wpt/types';
import { dataHub } from '../events/hub.js';
import type { IAlarmTransition } from '../events/types.js';
import { latestState } from '../cache/latestState.js';
import { getAlarmDescription } from '../i18n/alarmDescriptions.js';
import { getActiveAlarmIndices } from '../persistence/alarmStore.js';
import { MqttConfigService } from './configService.js';
import { pushEvent } from './activityLog.js';

// Module-level state
let mqttClient: MqttClient | null = null;
let logger: FastifyBaseLogger | null = null;

interface CachedMqttConfig {
  siteId: string;
  machineId: string;
  publishMachine: boolean;
  publishAlarms: boolean;
  publishRfid: boolean;
  publishJobs: boolean;
}

/** Cached config to avoid DB query on every publish (refreshed every 30s) */
let cachedConfig: CachedMqttConfig | null = null;
let configCacheExpiry = 0;
const CONFIG_CACHE_TTL_MS = 30_000; // 30 seconds

async function getCachedConfig(): Promise<CachedMqttConfig> {
  const now = Date.now();
  if (cachedConfig && now < configCacheExpiry) {
    return cachedConfig;
  }
  try {
    const cfg = await MqttConfigService.getConfig();
    cachedConfig = {
      siteId: cfg.siteId,
      machineId: cfg.machineId,
      publishMachine: cfg.publishMachine,
      publishAlarms: cfg.publishAlarms,
      publishRfid: cfg.publishRfid,
      publishJobs: cfg.publishJobs,
    };
    configCacheExpiry = now + CONFIG_CACHE_TTL_MS;
    return cachedConfig;
  } catch (err) {
    logger?.error(
      { name: 'MqttPublisher', err: (err as Error).message },
      'Failed to read MQTT config from DB — suppressing publish until next read',
    );
    // Return all-disabled flags so we don't publish to a wrong topic when DB
    // is unreachable. siteId/machineId are placeholders; nothing will publish
    // because every publishX flag is false. Cache is left null so the next
    // call retries the DB read.
    return {
      siteId: '',
      machineId: '',
      publishMachine: false,
      publishAlarms: false,
      publishRfid: false,
      publishJobs: false,
    };
  }
}

/** Build a full topic path for this site/machine using the cached config. */
function buildTopic(cfg: CachedMqttConfig, ...segments: string[]): string {
  return mqttTopic(cfg.siteId, cfg.machineId, ...segments);
}

/** Publish JSON payload to MQTT, swallowing errors to never crash the pipeline */
async function safePublish(
  topicPath: string,
  payload: unknown,
  opts: { qos?: 0 | 1; retain?: boolean },
): Promise<void> {
  if (!mqttClient) return;
  try {
    const payloadStr = JSON.stringify(payload);
    await mqttClient.publishAsync(topicPath, payloadStr, {
      qos: opts.qos ?? 0,
      retain: opts.retain ?? false,
    });
    pushEvent('publish', `Published to ${topicPath} (${String(payloadStr.length)} bytes)`);
  } catch (err) {
    pushEvent('error', `Publish failed on ${topicPath}: ${(err as Error).message}`);
    logger?.error(
      { name: 'MqttPublisher', topic: topicPath, err: (err as Error).message },
      'MQTT publish failed',
    );
  }
}

/** Publish full machine snapshot to dt/snapshot (qos 0, retained) */
function publishMachineData(snapshot: IMachineSnapshot, timestamp: Date): void {
  if (!mqttClient) return;
  void (async () => {
    const cfg = await getCachedConfig();
    if (!cfg.publishMachine) return;
    await safePublish(
      buildTopic(cfg, ...MQTT_TOPIC_SUFFIXES.SNAPSHOT.split('/')),
      { ...snapshot, ts: timestamp.toISOString() },
      { qos: 0, retain: true },
    );
  })();
}

/** Publish alarm transitions and updated active alarm list */
function publishAlarmChange(transitions: IAlarmTransition[]): void {
  if (!mqttClient) return;
  void (async () => {
    const cfg = await getCachedConfig();
    if (!cfg.publishAlarms) return;

    // Publish individual activation/reset events
    for (const t of transitions) {
      const desc = {
        alarmIndex: t.alarmIndex,
        descriptionIt: getAlarmDescription(t.alarmIndex, 'it'),
        descriptionEn: getAlarmDescription(t.alarmIndex, 'en'),
        timestamp: t.timestamp.toISOString(),
      };

      if (t.active) {
        await safePublish(
          buildTopic(cfg, ...MQTT_TOPIC_SUFFIXES.ALARMS_ACTIVATE.split('/')),
          desc,
          { qos: 1, retain: false },
        );
      } else {
        await safePublish(
          buildTopic(cfg, ...MQTT_TOPIC_SUFFIXES.ALARMS_RESET.split('/')),
          desc,
          { qos: 1, retain: false },
        );
      }
    }

    // Publish updated active alarm list (retained)
    await publishActiveAlarmList(cfg);
  })();
}

/** Query active alarms from persistence and publish retained list */
async function publishActiveAlarmList(cfg?: CachedMqttConfig): Promise<void> {
  try {
    const resolved = cfg ?? (await getCachedConfig());
    if (!resolved.publishAlarms || !resolved.siteId || !resolved.machineId) return;
    const indices = await getActiveAlarmIndices();
    const activeAlarms: IActiveAlarm[] = indices.map((idx) => ({
      alarmIndex: idx,
      wordIndex: Math.floor(idx / 16),
      bitIndex: idx % 16,
      active: true as const,
      descriptionIt: getAlarmDescription(idx, 'it'),
      descriptionEn: getAlarmDescription(idx, 'en'),
      activatedAt: new Date().toISOString(),
    }));

    await safePublish(
      buildTopic(resolved, ...MQTT_TOPIC_SUFFIXES.ALARMS_ACTIVE.split('/')),
      activeAlarms,
      { qos: 1, retain: true },
    );
  } catch (err) {
    logger?.error(
      { name: 'MqttPublisher', err: (err as Error).message },
      'Failed to publish active alarm list',
    );
  }
}

/** Publish RFID user list (retained) */
function publishUserData(users: IRfidUser[]): void {
  if (!mqttClient) return;
  void (async () => {
    const cfg = await getCachedConfig();
    if (!cfg.publishRfid) return;
    await safePublish(
      buildTopic(cfg, ...MQTT_TOPIC_SUFFIXES.RFID_USERS.split('/')),
      users,
      { qos: 1, retain: true },
    );
  })();
}

/** Publish current job data (retained) */
function publishJobData(job: IJobData): void {
  if (!mqttClient) return;
  void (async () => {
    const cfg = await getCachedConfig();
    if (!cfg.publishJobs) return;
    await safePublish(
      buildTopic(cfg, ...MQTT_TOPIC_SUFFIXES.JOBS_CURRENT.split('/')),
      job,
      { qos: 1, retain: true },
    );
  })();
}

/**
 * Initialize the MQTT publisher: subscribe to all dataHub events
 * and bootstrap retained messages from latest state cache.
 */
export async function initMqttPublisher(client: MqttClient, log: FastifyBaseLogger): Promise<void> {
  mqttClient = client;
  logger = log;

  // Subscribe to dataHub events
  dataHub.onMachineData((snapshot, ts) => publishMachineData(snapshot, ts));
  dataHub.onAlarmChange((transitions) => publishAlarmChange(transitions));
  dataHub.onUserData((users) => publishUserData(users));
  dataHub.onJobData((job) => publishJobData(job));

  // Bootstrap retained messages from cache (use DB-backed siteId/machineId, not env)
  const bootstrapCfg = await getCachedConfig();
  const snapshot = latestState.getMachineSnapshot();
  if (snapshot) {
    void safePublish(
      buildTopic(bootstrapCfg, ...MQTT_TOPIC_SUFFIXES.SNAPSHOT.split('/')),
      { ...snapshot, ts: new Date().toISOString() },
      { qos: 0, retain: true },
    );
  }

  // Publish current active alarm list
  await publishActiveAlarmList(bootstrapCfg);

  log.info(
    { name: 'MqttPublisher' },
    'MQTT publisher initialized, subscribed to dataHub events',
  );
}

/** Shutdown the MQTT publisher (dataHub handlers check mqttClient != null) */
export function shutdownMqttPublisher(): void {
  mqttClient = null;
  logger = null;
  cachedConfig = null;
  configCacheExpiry = 0;
}
