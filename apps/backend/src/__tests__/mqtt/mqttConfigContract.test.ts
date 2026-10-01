/**
 * MQTT admin API contract.
 *
 * Phase 37-03: the 4 legacy stream toggles (publishMachine / publishAlarms /
 * publishRfid / publishJobs) are neither exposed nor accepted.
 *
 * Edge publish-only (audit 2026-10-01): the command namespace (siteId /
 * machineId), the command-bus connection and the on-box broker account API
 * (/mqtt/users) are retired. Status, test and config-save act on the
 * Sparkplug uplink only.
 *
 * Pattern: mirror energySettingsRoutes.test.ts — register only the
 * mqttRoutes plugin on a minimal Fastify app, mock MqttConfigService + auth
 * + SparkplugService so no real DB / MQTT broker is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ─── Auth mock: SUPER_ADMIN is granted by the x-test-role header ───────────
// The real SUPER_ADMIN guard lives in apps/backend/src/routes/mqtt.ts. This
// mock only exists to let the contract test exercise the Zod schema behind it.
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

// ─── MQTT config service mocks ────────────────────────────────────────────
const getPublicConfigMock = vi.fn();
const getConfigMock = vi.fn();
const updateConfigMock = vi.fn();

vi.mock('../../mqtt/configService.js', () => ({
  MqttConfigService: {
    getPublicConfig: getPublicConfigMock,
    getConfig: getConfigMock,
    updateConfig: updateConfigMock,
  },
}));

const sparkplugStopMock = vi.fn(async () => undefined);
const sparkplugInitMock = vi.fn(async () => undefined);
const sparkplugIsConnectedMock = vi.fn(() => false);
const sparkplugRequestRebirthMock = vi.fn(async () => undefined);
const sparkplugGetSessionStateMock = vi.fn(() => ({
  bdSeq: 0,
  seq: 0,
  edgeNodeId: null,
  clientId: null,
}));
vi.mock('../../mqtt/sparkplugService.js', () => ({
  SparkplugService: {
    stop: sparkplugStopMock,
    init: sparkplugInitMock,
    isConnected: sparkplugIsConnectedMock,
    requestRebirth: sparkplugRequestRebirthMock,
    getSessionState: sparkplugGetSessionStateMock,
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

// GET /api/mqtt/config response shape — no legacy publish_*, no command
// namespace (siteId/machineId).
const FAKE_PUBLIC_CONFIG = {
  id: 1,
  enabled: false,
  brokerHost: 'broker.example.com',
  brokerPort: 8883,
  username: 'NW30-020',
  passwordSet: true,
  useTls: false,
  caCert: null,
  sparkplugGroupId: 'WPT',
  sparkplugEdgeNodeId: 'NW30-020',
  publishCycleRecords: false,
  telemetryIntervalSeconds: 30,
  updatedAt: new Date('2026-04-14T12:00:00.000Z').toISOString(),
};

const LEGACY_FIELDS = ['publishMachine', 'publishAlarms', 'publishRfid', 'publishJobs'];

describe('MQTT admin API contract', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getPublicConfigMock.mockResolvedValue(FAKE_PUBLIC_CONFIG);
    getConfigMock.mockResolvedValue({ ...FAKE_PUBLIC_CONFIG, password: 'dev' });
    updateConfigMock.mockResolvedValue({ ...FAKE_PUBLIC_CONFIG, password: 'dev' });
    sparkplugIsConnectedMock.mockReturnValue(false);
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
    for (const field of LEGACY_FIELDS) expect(body).not.toHaveProperty(field);
    expect(body).toHaveProperty('sparkplugGroupId');
    expect(body).toHaveProperty('sparkplugEdgeNodeId');
  });

  // ─── D-12 + retired command namespace: stale clients fail loudly ────────
  it.each([...LEGACY_FIELDS, 'siteId', 'machineId'])(
    'PUT /api/mqtt/config rejects retired field %s with 400 and names it in details',
    async (field) => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/mqtt/config',
        headers: { 'x-test-role': 'SUPER_ADMIN' },
        payload: { [field]: field === 'siteId' || field === 'machineId' ? 'x' : true },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string; details: unknown };
      expect(body.error).toBe('Invalid config');
      // Zod .strict() emits an `unrecognized_keys` issue naming each unknown key.
      const serialized = JSON.stringify(body.details);
      expect(serialized).toContain(field);
      expect(serialized).toContain('unrecognized_keys');
      // Rejection happens at the Zod stage — no DB write, no uplink re-init.
      expect(updateConfigMock).not.toHaveBeenCalled();
      expect(sparkplugInitMock).not.toHaveBeenCalled();
    },
  );

  // ─── D-11: PUT accepts the Sparkplug uplink fields ───────────────────────
  it('PUT /api/mqtt/config accepts Sparkplug uplink fields (200)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/mqtt/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        telemetryIntervalSeconds: 30,
        sparkplugGroupId: 'WPT',
        sparkplugEdgeNodeId: 'NW30-020',
        publishCycleRecords: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
  });

  // ─── Regression guard for the 2026-04-20 sacchi verification bug ────────
  // Saving a new broker config must re-init the Sparkplug uplink, otherwise
  // it stays pinned to the pre-change (often null) state and
  // publishCycleRecord silently drops drained cycles.
  it('PUT /api/mqtt/config saves, then stops and re-initializes the Sparkplug uplink', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/mqtt/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { brokerHost: 'broker.example.com', brokerPort: 8883 },
    });

    expect(response.statusCode).toBe(200);
    expect(sparkplugStopMock).toHaveBeenCalledTimes(1);
    expect(sparkplugInitMock).toHaveBeenCalledTimes(1);

    // Ordering matters: save → stop → init. Stop before init prevents a
    // rogue second mqtt.js client against the stale config from lingering.
    const saveOrder = updateConfigMock.mock.invocationCallOrder[0] ?? 0;
    const stopOrder = sparkplugStopMock.mock.invocationCallOrder[0] ?? 0;
    const initOrder = sparkplugInitMock.mock.invocationCallOrder[0] ?? 0;
    expect(saveOrder).toBeLessThan(stopOrder);
    expect(stopOrder).toBeLessThan(initOrder);
  });

  // ─── Retired on-box broker account API ──────────────────────────────────
  it.each(['GET', 'POST'] as const)('%s /api/mqtt/users is gone (404)', async (method) => {
    const response = await app.inject({
      method,
      url: '/api/mqtt/users',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      ...(method === 'POST' ? { payload: {} } : {}),
    });
    expect(response.statusCode).toBe(404);
  });

  // ─── Status and test reflect the Sparkplug uplink, the only connection ──
  it('GET /api/mqtt/status reports the Sparkplug uplink as the connection state', async () => {
    sparkplugIsConnectedMock.mockReturnValue(true);
    const response = await app.inject({
      method: 'GET',
      url: '/api/mqtt/status',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.connected).toBe(true);
    expect(body).not.toHaveProperty('clientId');
  });

  it.each([
    [true, 200],
    [false, 503],
  ])('POST /api/mqtt/test with Sparkplug connected=%s returns %i', async (connected, status) => {
    sparkplugIsConnectedMock.mockReturnValue(connected);
    const response = await app.inject({
      method: 'POST',
      url: '/api/mqtt/test',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(response.statusCode).toBe(status);
  });
});
