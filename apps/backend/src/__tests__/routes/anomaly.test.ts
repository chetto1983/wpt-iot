// Phase 43 Plan 43-02 Task 1 — D-28 single-event fetch route tests for
// anomalyRoutes. `/events/:id` inherits the same `requireAuth` gate as the
// existing `/events` list endpoint (anomaly.ts:76). Mirrors the mock/inject
// discipline used by the Phase 42 anomalyDebug.test.ts — pure-unit route
// layer, services are `vi.mock`'d, no DB dependency.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMachineAnomalyEvent } from '@wpt/types';

// requireAuth preHandler mock: 401 on missing x-test-role header, otherwise pass.
// Mirrors the Phase 42 test file shape but for the `requireAuth` (any role) gate.
const requireAuthMock = vi.fn(async (request: any, reply: any) => {
  const role = request.headers['x-test-role'];
  if (!role) { reply.code(401).send({ error: 'Unauthorized' }); return; }
  request.session = {
    role,
    username: request.headers['x-test-username'] ?? 'test-user',
    userId: 1,
    sessionId: 'test-session',
  };
});

const requireRoleMock = vi.fn(
  (...requiredRoles: string[]) => async (request: any, reply: any) => {
    const role = request.headers['x-test-role'];
    if (!role) { reply.code(401).send({ error: 'Unauthorized' }); return; }
    if (!requiredRoles.includes(role)) { reply.code(403).send({ error: 'Forbidden' }); return; }
    request.session = {
      role,
      username: request.headers['x-test-username'] ?? 'test-user',
      userId: 1,
      sessionId: 'test-session',
    };
  },
);

vi.mock('../../auth/authHooks.js', () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock,
}));

// Anomaly service mocks: routes must never reach the real services / DB / detector.
const getByIdMock = vi.fn();
const listRecentMock = vi.fn();
const getReportDataMock = vi.fn();
const createPdfMock = vi.fn(async () => Buffer.from('%PDF-1.4 timezone test'));
const loadStateMock = vi.fn(async () => undefined);
const startMock = vi.fn();
const stopMock = vi.fn();
const saveStateMock = vi.fn(async () => undefined);

vi.mock('../../services/anomaly/index.js', () => ({
  machineAnomalyService: {
    loadState: loadStateMock,
    start: startMock,
    stop: stopMock,
    saveState: saveStateMock,
    getTrackingStatus: vi.fn(() => ({})),
    getLatest: vi.fn(() => null),
    getDetectorConfig: vi.fn(() => ({ warningThreshold: 2, criticalThreshold: 3 })),
    updateDetectorConfig: vi.fn(),
  },
  MachineAnomalyEvaluationService: { evaluate: vi.fn() },
  MachineAnomalyEventService: {
    getById: getByIdMock,
    listRecent: listRecentMock,
    acknowledgeEvent: vi.fn(),
    resolveEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getFeedbackStats: vi.fn(),
    getCorrelatedAlarms: vi.fn(),
    getReportData: getReportDataMock,
  },
  MachineAnomalyReplayService: { replay: vi.fn() },
  MachineAnomalyScenarioService: { run: vi.fn() },
}));

vi.mock('../../services/pdf/index.js', () => ({
  createDeterministicPdfBuffer: createPdfMock,
}));

vi.mock('../../services/applicationConfigService.js', () => ({
  ApplicationConfigService: {
    getTimezone: vi.fn(() => 'Asia/Tokyo'),
  },
}));

const { anomalyRoutes } = await import('../../routes/anomaly.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const sampleEvent: IMachineAnomalyEvent = {
  id: 42,
  observedAt: '2026-04-21T08:30:00.000Z',
  modeKey: '3:1:0',
  score: 4.7,
  flagged: true,
  warm: true,
  sampleCount: 128,
  topContributors: [
    { feature: 'thermal_01', zScore: 5.3, contribution: 0.42, direction: 'HIGH' },
    { feature: 'voltage_lln_v', zScore: 3.1, contribution: 0.18, direction: 'LOW' },
  ],
  status: 'OPEN',
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  resolutionCategory: null,
  createdAt: '2026-04-21T08:30:01.000Z',
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(anomalyRoutes, { prefix: '/api/anomaly' });
  await app.ready();
  return app;
}

// ===========================================================================
// GET /api/anomaly/events/:id — Phase 43 D-28 single-event fetch
// ===========================================================================

describe('GET /api/anomaly/events/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getByIdMock.mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomaly/events/42' });
    expect(res.statusCode).toBe(401);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('returns 200 with a single event for an authenticated caller (CLIENT)', async () => {
    getByIdMock.mockResolvedValue(sampleEvent);
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/events/42',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(200);
    expect(getByIdMock).toHaveBeenCalledWith(42);
    const body = res.json();
    // Response is the single IMachineAnomalyEvent, NOT wrapped in { events: [...] }.
    expect(body).toEqual(sampleEvent);
    expect(body).not.toHaveProperty('events');
  });

  it('returns 200 for WPT and SUPER_ADMIN roles', async () => {
    getByIdMock.mockResolvedValue(sampleEvent);
    for (const role of ['WPT', 'SUPER_ADMIN']) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/anomaly/events/42',
        headers: { 'x-test-role': role },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(getByIdMock).toHaveBeenCalledTimes(2);
  });

  it('returns 404 with { error: "Event not found" } for an unknown id', async () => {
    getByIdMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/events/9999999',
      headers: { 'x-test-role': 'WPT' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Event not found' });
    expect(getByIdMock).toHaveBeenCalledWith(9999999);
  });

  it('returns 400 with Zod issues for a non-numeric id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/events/not-a-number',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('issues');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('returns 400 for zero id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/events/0',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(400);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('returns 400 for negative id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/events/-5',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(400);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('returns 500 on service throw (masked error body)', async () => {
    getByIdMock.mockRejectedValue(new Error('DB is down'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomaly/events/42',
      headers: { 'x-test-role': 'CLIENT' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toEqual({ error: 'Internal error' });
  });
});

describe('GET /api/anomaly/report/pdf timezone', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createPdfMock.mockClear();
    getReportDataMock.mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('formats report timestamps in the configured application timezone', async () => {
    getReportDataMock.mockResolvedValue({
      period: {
        from: '2026-04-21T15:30:00.000Z',
        to: '2026-04-22T15:30:00.000Z',
        days: 1,
      },
      totalEvents: 1,
      byStatus: { OPEN: 1 },
      events: [{ ...sampleEvent, observedAt: '2026-04-21T15:30:00.000Z' }],
      feedback: { totalResolved: 0, truePositive: 0, falsePositive: 0, tpRate: null, fpRate: null, suggestion: null },
      correlations: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/anomaly/report/pdf?days=1',
      headers: { 'x-test-role': 'WPT' },
    });

    expect(response.statusCode).toBe(200);
    expect(createPdfMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(createPdfMock.mock.calls[0]?.[0])).toContain(
      '22/04/2026 00:30:00',
    );
  });
});
