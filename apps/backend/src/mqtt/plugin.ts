import fp from 'fastify-plugin';
import mqtt from 'mqtt';
import { config } from '../config.js';
import { mqttTopic, MQTT_TOPIC_SUFFIXES } from '@wpt/types';
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

  const client = await mqtt.connectAsync({
    host: config.mqttHost,
    port: config.mqttPort,
    protocol: 'mqtt' as const,
    protocolVersion: 5,
    clientId: `wpt-backend-${process.pid}`,
    username: config.mqttUsername,
    password: config.mqttPassword,
    clean: true,
    reconnectPeriod: 5000,
    will: {
      topic: connectionTopic,
      payload: Buffer.from(JSON.stringify({ online: false, timestamp: new Date().toISOString() })),
      qos: 1,
      retain: true,
      properties: { willDelayInterval: 30 },
    },
  });

  // Publish online status after successful connection
  await client.publishAsync(
    connectionTopic,
    JSON.stringify({ online: true, timestamp: new Date().toISOString() }),
    { qos: 1, retain: true },
  );

  fastify.decorate('mqtt', client);

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
