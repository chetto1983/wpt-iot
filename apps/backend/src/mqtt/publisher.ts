import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import type { IMachineSnapshot, IRfidUser, IJobData, IActiveAlarm } from '@wpt/types';
import { mqttTopic, MQTT_TOPIC_SUFFIXES } from '@wpt/types';
import { dataHub } from '../events/hub.js';
import type { IAlarmTransition } from '../events/types.js';
import { latestState } from '../cache/latestState.js';
import { getAlarmDescription } from '../i18n/alarmDescriptions.js';
import { getActiveAlarmIndices } from '../persistence/alarmStore.js';
import { config } from '../config.js';

// Module-level state
let mqttClient: MqttClient | null = null;
let logger: FastifyBaseLogger | null = null;

/** Build a full topic path for this site/machine */
function topic(...segments: string[]): string {
  return mqttTopic(config.mqttSiteId, config.mqttMachineId, ...segments);
}

/** Publish JSON payload to MQTT, swallowing errors to never crash the pipeline */
async function safePublish(
  topicPath: string,
  payload: unknown,
  opts: { qos?: 0 | 1; retain?: boolean },
): Promise<void> {
  if (!mqttClient) return;
  try {
    await mqttClient.publishAsync(topicPath, JSON.stringify(payload), {
      qos: opts.qos ?? 0,
      retain: opts.retain ?? false,
    });
  } catch (err) {
    logger?.error(
      { name: 'MqttPublisher', topic: topicPath, err: (err as Error).message },
      'MQTT publish failed',
    );
  }
}

/** Publish full machine snapshot to dt/snapshot (qos 0, retained) */
function publishMachineData(snapshot: IMachineSnapshot, timestamp: Date): void {
  if (!mqttClient) return;
  void safePublish(
    topic(...MQTT_TOPIC_SUFFIXES.SNAPSHOT.split('/')),
    { ...snapshot, ts: timestamp.toISOString() },
    { qos: 0, retain: true },
  );
}

/** Publish alarm transitions and updated active alarm list */
function publishAlarmChange(transitions: IAlarmTransition[]): void {
  if (!mqttClient) return;

  // Publish individual activation/reset events
  for (const t of transitions) {
    const desc = {
      alarmIndex: t.alarmIndex,
      descriptionIt: getAlarmDescription(t.alarmIndex, 'it'),
      descriptionEn: getAlarmDescription(t.alarmIndex, 'en'),
      timestamp: t.timestamp.toISOString(),
    };

    if (t.active) {
      void safePublish(
        topic(...MQTT_TOPIC_SUFFIXES.ALARMS_ACTIVATE.split('/')),
        desc,
        { qos: 1, retain: false },
      );
    } else {
      void safePublish(
        topic(...MQTT_TOPIC_SUFFIXES.ALARMS_RESET.split('/')),
        desc,
        { qos: 1, retain: false },
      );
    }
  }

  // Publish updated active alarm list (retained)
  void publishActiveAlarmList();
}

/** Query active alarms from persistence and publish retained list */
async function publishActiveAlarmList(): Promise<void> {
  try {
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
      topic(...MQTT_TOPIC_SUFFIXES.ALARMS_ACTIVE.split('/')),
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
  void safePublish(
    topic(...MQTT_TOPIC_SUFFIXES.RFID_USERS.split('/')),
    users,
    { qos: 1, retain: true },
  );
}

/** Publish current job data (retained) */
function publishJobData(job: IJobData): void {
  if (!mqttClient) return;
  void safePublish(
    topic(...MQTT_TOPIC_SUFFIXES.JOBS_CURRENT.split('/')),
    job,
    { qos: 1, retain: true },
  );
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

  // Bootstrap retained messages from cache
  const snapshot = latestState.getMachineSnapshot();
  if (snapshot) {
    void safePublish(
      topic(...MQTT_TOPIC_SUFFIXES.SNAPSHOT.split('/')),
      { ...snapshot, ts: new Date().toISOString() },
      { qos: 0, retain: true },
    );
  }

  // Publish current active alarm list
  await publishActiveAlarmList();

  log.info(
    { name: 'MqttPublisher' },
    'MQTT publisher initialized, subscribed to dataHub events',
  );
}

/** Shutdown the MQTT publisher (dataHub handlers check mqttClient != null) */
export function shutdownMqttPublisher(): void {
  mqttClient = null;
  logger = null;
}
