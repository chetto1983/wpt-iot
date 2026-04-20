// Phase 41 Plan 41-07 Task 2 — Vitest Fastify integration tests for the shadow
// diff route (GET /api/anomaly/shadow/diff). Covers D-19 route URL, D-20 role
// gate (401 unauth / 403 CLIENT / 200 WPT / 200 SUPER_ADMIN), D-21 response
// shape, D-22 service delegation (UNION ALL lives in the service), D-23
// default 24h window + from>to validation, and the service-throw → 500 path.
// Route mounts at /api/anomaly (per server.ts) + /shadow/diff (per plugin).

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Role-gate mock. requireRole(...roles) in the real module returns a
// preHandler that 401s when no session + 403s when role not in the list.
const requireRoleMock = vi.fn(
  (...requiredRoles: string[]) => async (request: any, reply: any) => {
    const role = request.headers['x-test-role'];
    if (!role) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    if (!requiredRoles.includes(role)) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    request.session = { role };
  },
);

vi.mock('../auth/authHooks.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireRole: requireRoleMock,
}));

// Mock the event service's getDiff so the route never touches the real DB.
const getDiffMock = vi.fn();
vi.mock('../services/anomaly/shadow/machineShadowAnomalyEventService.js', () => ({
  MachineShadowAnomalyEventService: {
    getDiff: getDiffMock,
    recordEvent: vi.fn(),
  },
}));

const { anomalyShadowRoutes } = await import('../routes/anomalyShadow.js');

const validFixture = {
  totals: {
    primary: { flagged: 2, total: 5 },
    shadow: { flagged: 4, total: 5 },
  },
  byModeKey: [
    {
      modeKey: '3:1:0',
      primary: { flagged: 2, total: 5 },
      shadow: { flagged: 4, total: 5 },
    },
  ],
  window: {
    from: '2026-04-19T00:00:00.000Z',
    to: '2026-04-20T00:00:00.000Z',
  },
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(anomalyShadowRoutes, { prefix: '/api/anomaly' });
  await app.ready();
  return app;
}

describe('GET /api/anomaly/shadow/diff', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getDiffMock.mockReset();
    getDiffMock.mockResolvedValue(validFixture);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // D-19: route mount URL confirmed.
  it('mounts at /api/anomaly/shadow/diff (D-19)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(200);
  });

  // D-20: role gate matrix — 401 unauth / 403 CLIENT / 200 WPT / 200 SUPER_ADMIN.
  it('returns 401 for unauthenticated requests (D-20)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
    });
    expect(res.statusCode).toBe(401);
    expect(getDiffMock).not.toHaveBeenCalled();
  });

  it('returns 403 for CLIENT role (D-20)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(403);
    expect(getDiffMock).not.toHaveBeenCalled();
  });

  it('returns 200 for WPT role (D-20)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 for SUPER_ADMIN role (D-20)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(200);
  });

  // D-21: response shape matches IShadowDiffResponse.
  it('response body matches IShadowDiffResponse shape (D-21)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'WPT' },
    });
    const body = res.json();
    expect(body).toHaveProperty('totals.primary.flagged', 2);
    expect(body).toHaveProperty('totals.primary.total', 5);
    expect(body).toHaveProperty('totals.shadow.flagged', 4);
    expect(body).toHaveProperty('totals.shadow.total', 5);
    expect(body.byModeKey).toHaveLength(1);
    expect(body.byModeKey[0]).toMatchObject({
      modeKey: '3:1:0',
      primary: { flagged: 2, total: 5 },
      shadow: { flagged: 4, total: 5 },
    });
    expect(body.window.from).toBe('2026-04-19T00:00:00.000Z');
    expect(body.window.to).toBe('2026-04-20T00:00:00.000Z');
  });

  // D-22: service delegation — route parses Dates and forwards to getDiff.
  it('delegates to MachineShadowAnomalyEventService.getDiff with parsed args (D-22)', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff?modeKey=3:1:0&from=2026-04-19T00:00:00Z&to=2026-04-20T00:00:00Z',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(getDiffMock).toHaveBeenCalledTimes(1);
    const callArg = getDiffMock.mock.calls[0]![0];
    expect(callArg.modeKey).toBe('3:1:0');
    expect(callArg.from).toBeInstanceOf(Date);
    expect(callArg.to).toBeInstanceOf(Date);
    expect(callArg.from.toISOString()).toBe('2026-04-19T00:00:00.000Z');
    expect(callArg.to.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  // D-23: missing from/to defaults to a 24h window.
  it('defaults missing from/to to a 24h window (D-23)', async () => {
    const before = Date.now();
    await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'WPT' },
    });
    const after = Date.now();

    expect(getDiffMock).toHaveBeenCalledTimes(1);
    const callArg = getDiffMock.mock.calls[0]![0];
    const windowMs = callArg.to.getTime() - callArg.from.getTime();
    // Exactly 24h by spec, but allow a generous tolerance for test runtime.
    expect(windowMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1_000);
    expect(windowMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1_000);
    // `to` is anchored at request-time — must sit inside the window we just measured.
    expect(callArg.to.getTime()).toBeGreaterThanOrEqual(before);
    expect(callArg.to.getTime()).toBeLessThanOrEqual(after);
  });

  // D-23: invalid from (not ISO datetime) returns 400.
  it('returns 400 when from is not a valid ISO datetime (D-23)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff?from=not-iso',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(400);
    expect(getDiffMock).not.toHaveBeenCalled();
  });

  // D-23: from > to returns 400.
  it('returns 400 when from > to (D-23)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff?from=2026-04-20T00:00:00Z&to=2026-04-19T00:00:00Z',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/from > to|Invalid window/i);
    expect(getDiffMock).not.toHaveBeenCalled();
  });

  // Service throw → 500 (no leak of the raw error message).
  it('returns 500 when the service throws', async () => {
    getDiffMock.mockReset();
    getDiffMock.mockRejectedValue(new Error('db down'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/shadow/diff',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Internal error');
    // Never echo the raw exception message back to the client.
    expect(body.error).not.toContain('db down');
  });
});
