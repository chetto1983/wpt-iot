/**
 * Phase 37-03 regression test — D-10 absence + D-12 rejection contract.
 *
 * Asserts that the MQTT admin config API no longer exposes or accepts the 4
 * legacy stream toggles (publishMachine / publishAlarms / publishRfid /
 * publishJobs) and that the D-09 Local command namespace fields (siteId +
 * machineId) are still present.
 *
 * Pattern: mirror energySettingsRoutes.test.ts — register only the
 * mqttRoutes plugin on a minimal Fastify app, mock MqttConfigService + auth
 * + connectionManager so no real DB / MQTT broker is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ─── Auth mock: SUPER_ADMIN is granted by the x-test-role header ───────────
// T-37-03-S1 mitigation note: the real SUPER_ADMIN guard is preserved in
// apps/backend/src/routes/mqtt.ts:31. This mock only exists to let the
// contract test exercise the narrowed Zod schema behind that guard.
const requireAuthMock = vi.fn(async (request: any, reply: any) => {
  const role = request.headers['x-test-role'];
  if (!role) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  request.session = { role };
});

const requireRoleMock = vi.fn(
  (requiredRole: string) => async (request: any, reply: any) => {
    await requireAuthMock(request, reply);
    if (reply.sent) return;
    if (request.session.role !== requiredRole) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  },
);

vi.mock('../../auth/authHooks.js', () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock,
}));

// ─── MQTT config service + connection manager mocks ───────────────────────
const getPublicConfigMock = vi.fn();
const getConfigMock = vi.fn();
const updateConfigMock = vi.fn();
const reloadMqttConnectionMock = vi.fn(async () => undefined);
const getMqttClientMock = vi.fn(() => null);

vi.mock('../../mqtt/configService.js', () => ({
  MqttConfigService: {
    getPublicConfig: getPublicConfigMock,
    getConfig: getConfigMock,
    updateConfig: updateConfigMock,
  },
}));

vi.mock('../../mqtt/connectionManager.js', () => ({
  getMqttClient: getMqttClientMock,
  reloadMqttConnection: reloadMqttConnectionMock,
}));

// DynSecClient + activityLog are touched by other mqttRoutes endpoints; stub
// them out so the plugin body registers cleanly even though only /mqtt/config
// is exercised in this file.
vi.mock('../../mqtt/dynSecClient.js', () => ({
  DynSecClient: class {
    async init(): Promise<void> { /* noop */ }
    shutdown(): void { /* noop */ }
    async listClients(): Promise<unknown[]> { return []; }
  },
}));

vi.mock('../../mqtt/activityLog.js', () => ({
  getEvents: vi.fn(() => []),
}));

const { mqttRoutes } = await import('../../routes/mqtt.js');

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(mqttRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

// Post-Phase-37 GET /api/mqtt/config response shape — no legacy publish_*,
// but siteId/machineId preserved per D-09.
const FAKE_PUBLIC_CONFIG = {
  id: 1,
  enabled: false,
  brokerHost: 'localhost',
  brokerPort: 1883,
  username: 'wpt-backend',
  passwordSet: true,
  siteId: 'site-01',
  machineId: 'wpt40-001',
  useTls: false,
  caCert: null,
  sparkplugGroupId: 'WPT',
  sparkplugEdgeNodeId: 'NW30-020',
  publishCycleRecords: false,
  telemetryIntervalSeconds: 30,
  updatedAt: new Date('2026-04-14T12:00:00.000Z').toISOString(),
};

describe('Phase 37 D-10/D-12 — MQTT config API contract narrowing', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getPublicConfigMock.mockResolvedValue(FAKE_PUBLIC_CONFIG);
    getConfigMock.mockResolvedValue({ ...FAKE_PUBLIC_CONFIG, password: 'dev' });
    updateConfigMock.mockResolvedValue({ ...FAKE_PUBLIC_CONFIG, password: 'dev' });
    reloadMqttConnectionMock.mockResolvedValue(undefined);
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  // ─── D-10: GET response body excludes legacy publish_* fields ────────────
  it('GET /api/mqtt/config response body excludes legacy publish_* fields (D-10)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/mqtt/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;

    // Legacy stream toggles must not appear anywhere in the response.
    expect(body).not.toHaveProperty('publishMachine');
    expect(body).not.toHaveProperty('publishAlarms');
    expect(body).not.toHaveProperty('publishRfid');
    expect(body).not.toHaveProperty('publishJobs');

    // Sparkplug + D-09 local command namespace fields must be present.
    expect(body).toHaveProperty('sparkplugGroupId');
    expect(body).toHaveProperty('sparkplugEdgeNodeId');
    expect(body).toHaveProperty('siteId');     // D-09 Local command namespace
    expect(body).toHaveProperty('machineId');  // D-09 Local command namespace
  });

  // ─── D-12: PUT rejects each removed legacy field with 400 + name in
  //           error.details (Zod strict unrecognized_keys) ─────────────────
  it.each(['publishMachine', 'publishAlarms', 'publishRfid', 'publishJobs'])(
    'PUT /api/mqtt/config rejects legacy field %s with 400 and names it in details (D-12)',
    async (field) => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/mqtt/config',
        headers: { 'x-test-role': 'SUPER_ADMIN' },
        payload: { [field]: true },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as {
        error: string;
        details: Array<{ code?: string; keys?: string[]; path?: unknown[]; message?: string }>;
      };
      expect(body.error).toBe('Invalid config');

      // Zod .strict() emits an `unrecognized_keys` issue whose `keys` array
      // lists each unknown property. The field name must be visible to the
      // client so stale callers fail loudly rather than drift silently.
      const serialized = JSON.stringify(body.details);
      expect(serialized).toContain(field);
      expect(serialized).toContain('unrecognized_keys');

      // Contract is purely rejection at Zod stage — no DB write, no reload.
      expect(updateConfigMock).not.toHaveBeenCalled();
      expect(reloadMqttConnectionMock).not.toHaveBeenCalled();
    },
  );

  it('PUT /api/mqtt/config rejects ALL 4 legacy fields together with 400 (D-12)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/mqtt/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        publishMachine: true,
        publishAlarms: true,
        publishRfid: false,
        publishJobs: false,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: string;
      details: Array<Record<string, unknown>>;
    };
    expect(body.error).toBe('Invalid config');

    const serialized = JSON.stringify(body.details);
    for (const field of ['publishMachine', 'publishAlarms', 'publishRfid', 'publishJobs']) {
      expect(serialized).toContain(field);
    }

    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  // ─── D-11: PUT still accepts Sparkplug + local broker fields ─────────────
  it('PUT /api/mqtt/config accepts Sparkplug + local broker fields (200)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/mqtt/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        telemetryIntervalSeconds: 30,
        sparkplugGroupId: 'WPT',
        sparkplugEdgeNodeId: 'NW30-020',
        publishCycleRecords: true,
        siteId: 'site-01',     // D-09: still accepted (Local command namespace)
        machineId: 'wpt40-001', // D-09: still accepted (Local command namespace)
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    // Accepted payload must not carry the 4 legacy fields.
    const passed = updateConfigMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(passed).not.toHaveProperty('publishMachine');
    expect(passed).not.toHaveProperty('publishAlarms');
    expect(passed).not.toHaveProperty('publishRfid');
    expect(passed).not.toHaveProperty('publishJobs');
    // D-09 local command namespace fields DO round-trip through the update.
    expect(passed).toHaveProperty('siteId', 'site-01');
    expect(passed).toHaveProperty('machineId', 'wpt40-001');
  });

  // ─── D-09 regression guard: the local command namespace fields must not
  //     be accidentally stripped alongside the publish_* removal ────────────
  it('GET /api/mqtt/config preserves siteId and machineId (D-09)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/mqtt/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.siteId).toBe('site-01');
    expect(body.machineId).toBe('wpt40-001');
  });
});
