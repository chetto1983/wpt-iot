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
  sessionCookieSecure: parseBoolean(process.env.SESSION_COOKIE_SECURE, false),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  // Permissive dev/LAN default: wpt.local (mDNS alias), raw localhost, and
  // a wildcard for any http://<anything>:3001 origin. Production deployments
  // OVERRIDE this via CORS_ORIGIN in .env (install-linux.sh / install-prod.sh
  // bake the current LAN IP in). The default exists so a misconfigured or
  // stale .env does not silently lock browsers out of /auth/login.
  corsOrigin: (
    process.env.CORS_ORIGIN ??
      'http://wpt.local:3001,http://localhost:3001'
  ).split(','),

} as const;

// All MQTT settings (broker host/port, credentials, TLS, site/machine
// identity, publish flags) live in the `mqtt_config` DB row and are managed
// via the UI form. There are intentionally no MQTT_* env vars here.
