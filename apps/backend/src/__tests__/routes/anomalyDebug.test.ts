// Phase 42 Plan 42-05 Task 3 -- D-26 Fastify inject route tests for
// anomalyDebug. D-20 SUPER_ADMIN-only gate (401/403/200 -- stricter than
// Phase 41 shadow routes), D-08 429 concurrency body, D-04 204/404 DELETE,
// Zod 400, D-13 Cache-Control, D-18 audit log. Per-file beforeEach
// (Platformatic 2025, D-26 -- no shared session fixture across files).

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// requireRole(...) preHandler mock: 401 no header / 403 wrong role / pass otherwise.
const requireRoleMock = vi.fn(
  (...requiredRoles: string[]) => async (request: any, reply: any) => {
    const role = request.headers['x-test-role'];
    if (!role) { reply.code(401).send({ error: 'Unauthorized' }); return; }
    if (!requiredRoles.includes(role)) { reply.code(403).send({ error: 'Forbidden' }); return; }
    request.session = {
      role,
      sessionId: request.headers['x-test-session-id'] ?? 'test-session-' + role,
    };
  },
);

vi.mock('../../auth/authHooks.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireRole: requireRoleMock,
}));

// Service mocks: routes must never reach the real services.
const assembleStateMock = vi.fn();
const startMock = vi.fn();
const cancelMock = vi.fn();
const onSessionCloseMock = vi.fn();
const getActiveJobCountMock = vi.fn(() => 0);
// Phase 43 D-15 + D-26 hop 3: snapshot query services (extracted per Approach A).
const fetchHistogramMock = vi.fn();
const fetchSnapshotAtMock = vi.fn();

class MockConcurrencyError extends Error {
  readonly activeJobs: number;
  constructor(activeJobs: number) {
    super(`Replay concurrency limit reached: ${activeJobs} active jobs`);
    this.name = 'AnomalyReplayConcurrencyError';
    this.activeJobs = activeJobs;
  }
}

vi.mock('../../services/anomaly/debug/debugStateService.js', () => ({
  DebugStateService: { assembleState: assembleStateMock },
}));

vi.mock('../../services/anomaly/debug/anomalyDebugReplayService.js', () => ({
  AnomalyDebugReplayService: {
    start: startMock,
    cancel: cancelMock,
    onSessionClose: onSessionCloseMock,
    getActiveJobCount: getActiveJobCountMock,
  },
  AnomalyReplayConcurrencyError: MockConcurrencyError,
}));

// Phase 43 D-15: histogram query service mock (Approach A — service extraction).
vi.mock('../../services/anomaly/debug/snapshotHistogramService.js', () => ({
  SnapshotHistogramService: { fetch: fetchHistogramMock },
}));

// Phase 43 D-26 hop 3: nearest-snapshot query service mock (Approach A).
vi.mock('../../services/anomaly/debug/snapshotAtService.js', () => ({
  SnapshotAtService: { fetch: fetchSnapshotAtMock },
}));

const { anomalyDebugRoutes } = await import('../../routes/anomalyDebug.js');

// ---------------------------------------------------------------------------
// Test fixtures
// Compact fixture: route handler does NOT validate the response in test mode
// (NODE_ENV stays at 'test' which the IS_DEV check still treats as dev, so
// we must produce a Zod-valid envelope -- but we share metrics/snapshot
// stubs to keep the file under the LOC budget).
const m = {
  totalObservations: 0,
  totalFlagged: 0,
  totalWarnings: 0,
  modesTracked: 0,
  warmModes: 0,
  uptimeMs: 0,
  gracePeriodsEntered: 0,
};
const snap = {
  currentModeKey: '3:1:0',
  startedAt: '2026-04-20T10:00:00.000Z',
  totalObservations: 0,
  totalFlagged: 0,
  config: {} as Record<string, unknown>,
  metrics: m,
  modes: {} as Record<string, unknown>,
};
const validStateFixture = {
  data: {
    primary: { snapshot: snap, contributors: [], metrics: m },
    shadow: { snapshot: snap, metrics: m },
  },
  meta: {
    generatedAt: '2026-04-20T10:00:00.000Z',
    isStale: true,
    lastObservationAt: null,
    detectorVersion: 'v1.4',
  },
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(anomalyDebugRoutes, { prefix: '/api/anomaly' });
  await app.ready();
  return app;
}

// ===========================================================================
// GET /api/anomaly/debug/state
// ===========================================================================

describe('GET /api/anomaly/debug/state', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    assembleStateMock.mockReset();
    assembleStateMock.mockReturnValue(validStateFixture);
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated (D-20)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomaly/debug/state' });
    expect(res.statusCode).toBe(401);
    expect(assembleStateMock).not.toHaveBeenCalled();
  });

  it('returns 403 for CLIENT (D-20)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/state',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(403);
    expect(assembleStateMock).not.toHaveBeenCalled();
  });

  it('returns 403 for WPT (D-20 -- stricter than Phase 41 which allows WPT on /shadow/diff)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/state',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(403);
    expect(assembleStateMock).not.toHaveBeenCalled();
  });

  it('returns 200 for SUPER_ADMIN with Cache-Control: no-store (D-13)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/state',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toHaveProperty('data.primary');
    expect(body).toHaveProperty('data.shadow');
    expect(body).toHaveProperty('meta.detectorVersion', 'v1.4');
    // D-12 structural omission: shadow MUST NOT carry contributors.
    expect(body.data.shadow).not.toHaveProperty('contributors');
  });

  it('returns 500 when assembleState throws', async () => {
    assembleStateMock.mockReset();
    assembleStateMock.mockImplementation(() => {
      throw new Error('detector exploded');
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/state',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Internal error');
    // Never echo the raw exception message back to the client.
    expect(body.error).not.toContain('detector exploded');
  });
});

// ===========================================================================
// POST /api/anomaly/debug/replay
// ===========================================================================

describe('POST /api/anomaly/debug/replay', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    startMock.mockReset();
    startMock.mockReturnValue({ streamId: 'stream-abc-123' });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 403 for CLIENT (D-20)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'CLIENT' },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(403);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 403 for WPT (D-20)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'WPT' },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(403);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 200 + { streamId } for SUPER_ADMIN with valid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ streamId: 'stream-abc-123' });
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when body is missing required fields (Zod)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { from: '2026-04-20T00:00:00.000Z' /* to missing */ },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('issues');
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 400 when from is not ISO datetime', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { from: 'not-iso', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(400);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('returns 400 when maxRows exceeds the 200_000 ceiling', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        from: '2026-04-20T00:00:00.000Z',
        to: '2026-04-20T01:00:00.000Z',
        maxRows: 500_000,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(startMock).not.toHaveBeenCalled();
  });

  // D-08: concurrency overflow returns 429 with exact body + Retry-After header.
  it("returns 429 with { error: 'Concurrency limit', retryAfter: 30, active: 2 } when service throws", async () => {
    startMock.mockImplementation(() => {
      throw new MockConcurrencyError(2);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    const body = res.json();
    expect(body).toEqual({ error: 'Concurrency limit', retryAfter: 30, active: 2 });
  });

  it('returns 500 when service throws an unexpected error', async () => {
    startMock.mockImplementation(() => {
      throw new Error('disk full');
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('Internal error');
    expect(res.json().error).not.toContain('disk full');
  });

  it('passes Date-typed from/to to the service (ISO string -> new Date())', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(startMock).toHaveBeenCalledTimes(1);
    const params = (startMock.mock.calls[0] as unknown[])[0] as {
      from: Date;
      to: Date;
    };
    expect(params.from).toBeInstanceOf(Date);
    expect(params.to).toBeInstanceOf(Date);
    expect(params.from.toISOString()).toBe('2026-04-20T00:00:00.000Z');
    expect(params.to.toISOString()).toBe('2026-04-20T01:00:00.000Z');
  });

  it('forwards sessionId from request.session to the service', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/anomaly/debug/replay',
      headers: {
        'x-test-role': 'SUPER_ADMIN',
        'x-test-session-id': 'sess-deadbeef',
      },
      payload: { from: '2026-04-20T00:00:00.000Z', to: '2026-04-20T01:00:00.000Z' },
    });
    expect(startMock).toHaveBeenCalledTimes(1);
    const sessionId = (startMock.mock.calls[0] as unknown[])[1];
    expect(sessionId).toBe('sess-deadbeef');
  });

  // D-18: audit log fires at POST entry with the documented payload keys.
  // We spy on app.log.info via a shim Fastify logger that records calls.
  it('emits a Pino .info audit log at POST entry with D-18 payload keys', async () => {
    const infoSpy = vi.fn();
    // Build a Fastify with a logger shim so we can capture log calls.
    const audited = Fastify({
      logger: {
        level: 'info',
        // Use a custom write target so .info() is observable.
        stream: {
          write: (chunk: string) => {
            try {
              const obj = JSON.parse(chunk);
              if (obj.name === 'MachineAnomalyDebugReplay') infoSpy(obj);
            } catch {
              // not JSON -- ignore
            }
          },
        } as unknown as NodeJS.WritableStream,
      } as never,
    });
    await audited.register(anomalyDebugRoutes, { prefix: '/api/anomaly' });
    await audited.ready();

    try {
      await audited.inject({
        method: 'POST',
        url: '/api/anomaly/debug/replay',
        headers: {
          'x-test-role': 'SUPER_ADMIN',
          'x-test-session-id': 'sess-audit-1',
        },
        payload: {
          from: '2026-04-20T00:00:00.000Z',
          to: '2026-04-20T01:00:00.000Z',
          maxRows: 1000,
          topN: 5,
        },
      });

      // At least one MachineAnomalyDebugReplay info log fired.
      expect(infoSpy).toHaveBeenCalled();
      const entry = infoSpy.mock.calls[0]![0] as Record<string, unknown>;
      // D-18 documented keys: configSource, requestedBy, from, to (rowCount and
      // durationMs are filled by the service on end frame, NOT at POST entry).
      expect(entry.configSource).toBe('defaults');
      expect(entry.requestedBy).toBe('sess-audit-1');
      expect(entry.from).toBe('2026-04-20T00:00:00.000Z');
      expect(entry.to).toBe('2026-04-20T01:00:00.000Z');
      expect(entry.maxRows).toBe(1000);
      expect(entry.topN).toBe(5);
    } finally {
      await audited.close();
    }
  });
});

// ===========================================================================
// DELETE /api/anomaly/debug/replay/:streamId
// ===========================================================================

describe('DELETE /api/anomaly/debug/replay/:streamId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    cancelMock.mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/anomaly/debug/replay/some-id',
    });
    expect(res.statusCode).toBe(401);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('returns 403 for CLIENT (D-20)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/anomaly/debug/replay/some-id',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(403);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('returns 403 for WPT (D-20)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/anomaly/debug/replay/some-id',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(403);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('returns 204 when cancel returns true (D-04)', async () => {
    cancelMock.mockReturnValue(true);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/anomaly/debug/replay/stream-abc-123',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(204);
    expect(cancelMock).toHaveBeenCalledWith('stream-abc-123');
  });

  it('returns 404 when cancel returns false (streamId not found)', async () => {
    cancelMock.mockReturnValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/anomaly/debug/replay/unknown-id',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(404);
    expect(cancelMock).toHaveBeenCalledWith('unknown-id');
  });
});

// ===========================================================================
// GET /api/anomaly/debug/snapshot-histogram (Phase 43 D-15)
// ===========================================================================

describe('GET /api/anomaly/debug/snapshot-histogram', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    fetchHistogramMock.mockReset();
    // Default fixture: 3 non-empty hourly buckets, totalCount = 15.
    fetchHistogramMock.mockResolvedValue({
      buckets: [
        { bucket: '2026-04-20T08:00:00.000Z', count: 5 },
        { bucket: '2026-04-20T09:00:00.000Z', count: 7 },
        { bucket: '2026-04-20T10:00:00.000Z', count: 3 },
      ],
      totalCount: 15,
    });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=2026-04-20T00:00:00.000Z&to=2026-04-21T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(401);
    expect(fetchHistogramMock).not.toHaveBeenCalled();
  });

  it('returns 403 for CLIENT (D-20 plugin-level gate inherits)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=2026-04-20T00:00:00.000Z&to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(403);
    expect(fetchHistogramMock).not.toHaveBeenCalled();
  });

  it('returns 403 for WPT (D-20 stricter than Phase 41)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=2026-04-20T00:00:00.000Z&to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(403);
    expect(fetchHistogramMock).not.toHaveBeenCalled();
  });

  it('returns 200 for SUPER_ADMIN with valid from/to + correct shape + Cache-Control: no-store', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=2026-04-20T00:00:00.000Z&to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(body.buckets.length).toBe(3);
    // Each bucket parses as a valid Date (ISO datetime string).
    for (const b of body.buckets as Array<{ bucket: string; count: number }>) {
      expect(Number.isNaN(new Date(b.bucket).getTime())).toBe(false);
    }
    // Monotonic ascending order.
    const ts = (body.buckets as Array<{ bucket: string }>).map((b) => new Date(b.bucket).getTime());
    expect(ts.every((t, i) => i === 0 || t >= ts[i - 1]!)).toBe(true);
    // totalCount == sum(bucket.count).
    const sum = (body.buckets as Array<{ count: number }>).reduce((s, b) => s + b.count, 0);
    expect(body.totalCount).toBe(sum);
    expect(fetchHistogramMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when from is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('issues');
    expect(fetchHistogramMock).not.toHaveBeenCalled();
  });

  it('returns 400 when from is not an ISO datetime', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=not-a-date&to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('issues');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(fetchHistogramMock).not.toHaveBeenCalled();
  });

  it('forwards ISO from/to strings to SnapshotHistogramService.fetch', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=2026-04-20T00:00:00.000Z&to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(fetchHistogramMock).toHaveBeenCalledTimes(1);
    const args = fetchHistogramMock.mock.calls[0] as unknown[];
    expect(args[0]).toBe('2026-04-20T00:00:00.000Z');
    expect(args[1]).toBe('2026-04-21T00:00:00.000Z');
  });

  it('returns 500 when the histogram service throws', async () => {
    fetchHistogramMock.mockRejectedValue(new Error('database is down'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/debug/snapshot-histogram?from=2026-04-20T00:00:00.000Z&to=2026-04-21T00:00:00.000Z',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe('Internal error');
    // Never echo the raw exception message back to the client.
    expect(body.error).not.toContain('database is down');
  });
});
