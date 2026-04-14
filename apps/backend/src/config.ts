import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

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
  // PLC target host is NOT in env anymore — it lives in the `plc_config` DB
  // row and is read via `getCachedPlcConfig()` in `udp/plcConfigService.ts`.
  // Operators change it from the frontend UI (SUPER_ADMIN only).
  handshakeTimeoutMs: Number(process.env.HANDSHAKE_TIMEOUT_MS ?? 5000),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-session-secret-minimum-32-chars!!',
  sessionCookieSecure: parseBoolean(process.env.SESSION_COOKIE_SECURE, true),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),

  // CORS is deliberately eliminated as an attack surface — the backend emits
  // no Access-Control-Allow-* headers. Browser traffic reaches the API only
  // through the same origin as the frontend (nginx in prod, Next.js rewrite
  // in dev). Same-Origin Policy enforces isolation with zero configuration
  // and zero IP-coupled allowlist to maintain. See server.ts CORS block.

} as const;

// All MQTT settings (broker host/port, credentials, TLS, site/machine
// identity, publish flags) live in the `mqtt_config` DB row and are managed
// via the UI form. There are intentionally no MQTT_* env vars here.
