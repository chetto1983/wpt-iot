import fp from 'fastify-plugin';
import mqtt from 'mqtt';
import { config } from '../config.js';
import { mqttTopic, MQTT_TOPIC_SUFFIXES } from '@wpt/types';
import { pushEvent } from './activityLog.js';
import './types.js';

import type { FastifyInstance } from 'fastify';

/**
 * Fastify MQTT plugin: connects to Mosquitto broker with MQTT v5,
 * configures Last Will and Testament for connection status,
 * and provides `fastify.mqtt` client to other modules.
 *
 * Respects `config.mqttEnabled` — returns early if MQTT is disabled.
 */
async function mqttPlugin(fastify: FastifyInstance): Promise<void> {
  if (!config.mqttEnabled) {
    fastify.log.info({ name: 'MQTT' }, 'MQTT disabled by config');
    return;
  }

  const connectionTopic = mqttTopic(
    config.mqttSiteId,
    config.mqttMachineId,
    ...MQTT_TOPIC_SUFFIXES.CONNECTION.split('/'),
  );

  // TLS configuration
  const useTls = config.mqttUseTls;
  const tlsOptions: Record<string, unknown> = {};

  if (useTls) {
    tlsOptions.rejectUnauthorized = true;
    if (config.mqttCaCert) {
      tlsOptions.ca = [Buffer.from(config.mqttCaCert)];
    }
  }

  let client: mqtt.MqttClient;
  try {
    client = await mqtt.connectAsync({
      host: config.mqttHost,
      port: config.mqttPort,
      protocol: (useTls ? 'mqtts' : 'mqtt') as 'mqtt' | 'mqtts',
      protocolVersion: 5,
      ...tlsOptions,
      clientId: `wpt-backend-${process.pid}`,
      username: config.mqttUsername,
      password: config.mqttPassword,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      will: {
        topic: connectionTopic,
        payload: Buffer.from(JSON.stringify({ online: false, timestamp: new Date().toISOString() })),
        qos: 1,
        retain: true,
        properties: { willDelayInterval: 30 },
      },
    });
  } catch (err) {
    fastify.log.error(
      { name: 'MQTT', broker: `${config.mqttHost}:${config.mqttPort}`, err },
      'Failed to connect to MQTT broker — continuing without MQTT',
    );
    return;
  }

  // Publish online status after successful connection
  await client.publishAsync(
    connectionTopic,
    JSON.stringify({ online: true, timestamp: new Date().toISOString() }),
    { qos: 1, retain: true },
  );

  fastify.decorate('mqtt', client);

  // Log initial connection to activity ring buffer
  pushEvent('connect', `Connected to ${config.mqttHost}:${String(config.mqttPort)}`);

  // Wire activity log to client events
  client.on('connect', () => {
    pushEvent('connect', `Connected to ${config.mqttHost}:${String(config.mqttPort)}`);
  });
  client.on('close', () => {
    pushEvent('disconnect', `Disconnected from ${config.mqttHost}:${String(config.mqttPort)}`);
  });
  client.on('error', (err) => {
    pushEvent('error', `MQTT error: ${err.message}`);
  });

  // Graceful shutdown: publish offline status then disconnect
  fastify.addHook('onClose', async () => {
    try {
      await client.publishAsync(
        connectionTopic,
        JSON.stringify({ online: false, timestamp: new Date().toISOString() }),
        { qos: 1, retain: true },
      );
    } catch {
      // Best-effort offline publish during shutdown
    }
    await client.endAsync(true);
  });

  fastify.log.info(
    { name: 'MQTT', broker: `${config.mqttHost}:${config.mqttPort}` },
    'MQTT client connected to broker',
  );
}

export default fp(mqttPlugin, { name: 'mqtt-plugin' });
