import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  pgHost: process.env.PG_HOST ?? 'localhost',
  pgPort: Number(process.env.PG_PORT ?? 5432),
  pgDb: process.env.PG_DB ?? 'wpt',
  pgUser: process.env.PG_USERNAME ?? 'wpt',
  pgPassword: process.env.PG_PASSWORD ?? 'wpt_dev_password',
  udpPortData: Number(process.env.UDP_PORT_DATA ?? 9090),
  udpPortAlarms: Number(process.env.UDP_PORT_ALARMS ?? 9091),
  udpPortUsers: Number(process.env.UDP_PORT_USERS ?? 9092),
  udpPortAck: Number(process.env.UDP_PORT_ACK ?? 9093),
  udpAddress: process.env.UDP_ADDRESS ?? '0.0.0.0',
  simAckPort: Number(process.env.SIM_ACK_PORT ?? 19093),
  simDataPort: Number(process.env.SIM_DATA_PORT ?? 19090),
  simUsersPort: Number(process.env.SIM_USERS_PORT ?? 19092),
  simHost: process.env.SIM_HOST ?? 'localhost',
  handshakeTimeoutMs: Number(process.env.HANDSHAKE_TIMEOUT_MS ?? 5000),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-session-secret-minimum-32-chars!!',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3001').split(','),

  // MQTT Gateway
  mqttHost: process.env.MQTT_HOST ?? 'localhost',
  mqttPort: Number(process.env.MQTT_PORT ?? 1883),
  mqttUsername: process.env.MQTT_USERNAME ?? 'wpt-backend',
  mqttPassword: process.env.MQTT_PASSWORD ?? 'wpt_mqtt_dev_password',
  mqttEnabled: (process.env.MQTT_ENABLED ?? 'true') === 'true',
  mqttSiteId: process.env.MQTT_SITE_ID ?? 'site-01',
  mqttMachineId: process.env.MQTT_MACHINE_ID ?? 'wpt40-001',
  mqttUseTls: (process.env.MQTT_USE_TLS ?? 'false') === 'true',
  mqttCaCert: process.env.MQTT_CA_CERT ?? '',
} as const;
