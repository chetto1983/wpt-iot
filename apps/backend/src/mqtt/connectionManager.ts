import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import { mqttTopic, MQTT_TOPIC_SUFFIXES } from '@wpt/types';
import { MqttConfigService } from './configService.js';
import { pushEvent } from './activityLog.js';
import { initCommandHandler, shutdownCommandHandler } from './commandHandler.js';

/**
 * Owns the MQTT broker connection lifecycle.
 *
 * The connection's host, port, TLS settings, site/machine identity, and
 * enabled flag all come from the `mqtt_config` row in the database — never
 * from environment variables. Only the broker username/password remain in
 * env vars (they are credentials, not configuration).
 *
 * The command handler is wired up here after a successful connect (the
 * legacy outbound publisher was retired in Phase 37 — Sparkplug B is the
 * sole cloud uplink, owned by SparkplugService).
 */

let currentClient: MqttClient | null = null;

/**
 * Gate for the `error` event handler. mqtt.js emits `error` during a graceful
 * `client.endAsync(true)` teardown with `message === 'client disconnecting'`.
 * That is expected behavior on reload — NOT a real fault. We demote it to a
 * debug-level log and skip the activity-log pushEvent during this exact window.
 *
 * Scope is intentionally narrow: only the `doDisconnect()` call site sets this
 * flag, and it is cleared immediately after `endAsync` resolves. Any other
 * error path (connect failure, broker disconnect, TLS error) still emits
 * `pushEvent('error', ...)` loudly.
 */
let teardownInFlight = false;

// Serialize connect / disconnect / reload behind a single chain so concurrent
// PUT /api/mqtt/config requests cannot interleave broker connections.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const next = chain.then(op, op);
  // Swallow errors in the chain itself; the original promise still rejects.
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Returns the live MQTT client, or null if MQTT is disabled or disconnected. */
export function getMqttClient(): MqttClient | null {
  return currentClient;
}

/** Connect to the broker using current DB config and initialize subsystems. */
export function connectMqtt(log: FastifyBaseLogger): Promise<void> {
  return serialize(() => doConnect(log));
}

/** Tear down subsystems and disconnect from the broker. */
export function disconnectMqtt(log: FastifyBaseLogger): Promise<void> {
  return serialize(() => doDisconnect(log));
}

/** Disconnect → reconnect using fresh DB config. Called after PUT /api/mqtt/config. */
export function reloadMqttConnection(log: FastifyBaseLogger): Promise<void> {
  return serialize(async () => {
    log.info({ name: 'MQTT' }, 'Reloading MQTT connection from DB config');
    await doDisconnect(log);
    await doConnect(log);
  });
}

async function doConnect(log: FastifyBaseLogger): Promise<void> {
  if (currentClient) {
    log.warn({ name: 'MQTT' }, 'connectMqtt called while client already exists, skipping');
    return;
  }

  let cfg;
  try {
    cfg = await MqttConfigService.getConfig();
  } catch (err) {
    log.error({ name: 'MQTT', err }, 'Failed to read MQTT config from DB, aborting connect');
    return;
  }

  if (!cfg.enabled) {
    log.info({ name: 'MQTT' }, 'MQTT disabled by DB config, not connecting');
    return;
  }

  const connectionTopic = mqttTopic(
    cfg.siteId,
    cfg.machineId,
    ...MQTT_TOPIC_SUFFIXES.CONNECTION.split('/'),
  );

  const tlsOptions: Record<string, unknown> = {};
  if (cfg.useTls) {
    tlsOptions.rejectUnauthorized = true;
    if (cfg.caCert) {
      tlsOptions.ca = [Buffer.from(cfg.caCert)];
    }
  }

  let client: MqttClient;
  try {
    client = await mqtt.connectAsync({
      host: cfg.brokerHost,
      port: cfg.brokerPort,
      protocol: (cfg.useTls ? 'mqtts' : 'mqtt') as 'mqtt' | 'mqtts',
      protocolVersion: 5,
      ...tlsOptions,
      clientId: `wpt-backend-${process.pid}`,
      username: cfg.username,
      password: cfg.password,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      will: {
        topic: connectionTopic,
        payload: Buffer.from(
          JSON.stringify({ online: false, timestamp: new Date().toISOString() }),
        ),
        qos: 1,
        retain: true,
        properties: { willDelayInterval: 30 },
      },
    });
  } catch (err) {
    log.error(
      { name: 'MQTT', broker: `${cfg.brokerHost}:${String(cfg.brokerPort)}`, err },
      'Failed to connect to MQTT broker — staying offline',
    );
    return;
  }

  // Online retained status
  try {
    const onlinePayload = JSON.stringify({ online: true, timestamp: new Date().toISOString() });
    await client.publishAsync(connectionTopic, onlinePayload, { qos: 1, retain: true });
    pushEvent('publish', `${connectionTopic} (${Buffer.byteLength(onlinePayload)} B, LWT online)`);
  } catch (err) {
    log.warn({ name: 'MQTT', err }, 'Failed to publish online status');
  }

  pushEvent('connect', `Connected to ${cfg.brokerHost}:${String(cfg.brokerPort)}`);
  client.on('connect', () => {
    pushEvent('connect', `Connected to ${cfg.brokerHost}:${String(cfg.brokerPort)}`);
  });
  client.on('close', () => {
    pushEvent('disconnect', `Disconnected from ${cfg.brokerHost}:${String(cfg.brokerPort)}`);
  });
  client.on('error', (err) => {
    // Bug C fix: mqtt.js emits `error` during graceful endAsync(true) with
    // `message === 'client disconnecting'`. Demote that exact case to debug
    // and skip the activity-log pushEvent; any other error is still logged
    // loudly as before.
    if (teardownInFlight && err.message === 'client disconnecting') {
      log.debug({ name: 'MQTT', err }, 'Benign "client disconnecting" during teardown (demoted)');
      return;
    }
    pushEvent('error', `MQTT error: ${err.message}`);
  });

  currentClient = client;

  // Wire up subsystems with this connection. Topic prefix is computed once
  // here from the DB values; on reload these are torn down and rebuilt.
  // Phase 37 D-07: legacy outbound publisher retired — Sparkplug B is the sole
  // cloud uplink, owned by SparkplugService (see mqtt/sparkplugService.ts).
  // D-08 preserved: the local command handler (cmd/+/req namespace) stays.
  const topicPrefix = mqttTopic(cfg.siteId, cfg.machineId);
  await initCommandHandler(client, log, topicPrefix);

  log.info(
    {
      name: 'MQTT',
      broker: `${cfg.brokerHost}:${String(cfg.brokerPort)}`,
      siteId: cfg.siteId,
      machineId: cfg.machineId,
    },
    'MQTT connected and subsystems initialized',
  );
}

async function doDisconnect(log: FastifyBaseLogger): Promise<void> {
  const client = currentClient;
  if (!client) return;

  // Best-effort offline LWT publish before disconnecting.
  try {
    const cfg = await MqttConfigService.getConfig();
    const connectionTopic = mqttTopic(
      cfg.siteId,
      cfg.machineId,
      ...MQTT_TOPIC_SUFFIXES.CONNECTION.split('/'),
    );
    const offlinePayload = JSON.stringify({ online: false, timestamp: new Date().toISOString() });
    await client.publishAsync(connectionTopic, offlinePayload, { qos: 1, retain: true });
    pushEvent('publish', `${connectionTopic} (${Buffer.byteLength(offlinePayload)} B, LWT offline)`);
  } catch (err) {
    log.warn({ name: 'MQTT', err }, 'Best-effort offline publish failed during disconnect');
  }

  shutdownCommandHandler();

  // Bug C fix: scope the teardown window tightly around endAsync(true). The
  // `error` event handler above checks this flag to demote the expected
  // "client disconnecting" emission instead of treating it as a real fault.
  teardownInFlight = true;
  try {
    await client.endAsync(true);
  } catch (err) {
    log.warn({ name: 'MQTT', err }, 'client.endAsync errored during disconnect');
  } finally {
    teardownInFlight = false;
  }

  currentClient = null;
  log.info({ name: 'MQTT' }, 'MQTT disconnected and subsystems shut down');
}
