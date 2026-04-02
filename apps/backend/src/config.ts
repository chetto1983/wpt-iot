import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

export const config = {
  port: Number(process.env.PORT ?? 3001),
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
} as const;
