import type { MqttClient } from 'mqtt';

declare module 'fastify' {
  interface FastifyInstance {
    mqtt: MqttClient;
  }
}

/** Options for the MQTT plugin */
export interface IMqttPluginOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  clientId: string;
  siteId: string;
  machineId: string;
}
