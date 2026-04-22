import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const requireAuthMock = vi.fn(async (request: any, reply: any) => {
  const role = request.headers['x-test-role'];
  if (!role) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  request.session = { role };
});
const requireRoleMock = vi.fn(
  (...roles: string[]) =>
    async (request: any, reply: any) => {
      await requireAuthMock(request, reply);
      if (reply.sent) return;
      if (!roles.includes(request.session.role)) {
        reply.code(403).send({ error: 'Forbidden' });
      }
    },
);

const getDashboardSummaryMock = vi.fn();
const getCyclesMock = vi.fn();
const getReconciliationMock = vi.fn();

vi.mock('../auth/authHooks.js', () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock,
}));

vi.mock('../persistence/v03CycleTracker.js', () => ({
  startV03CycleTracker: vi.fn(),
}));

vi.mock('../persistence/cyclePersister.js', () => ({
  startCyclePersister: vi.fn(),
}));

vi.mock('../services/anomaly/machineAnomalyService.js', () => ({
  machineAnomalyService: {
    start: vi.fn(),
    stop: vi.fn(),
    loadState: vi.fn(async () => undefined),
    saveState: vi.fn(async () => undefined),
    getTrackingStatus: vi.fn(() => ({})),
    getLatest: vi.fn(() => null),
  },
}));

vi.mock('../services/energy/energyAttributionService.js', () => ({
  EnergyAttributionService: {
    detectAndPersistClosedCycles: vi.fn(async () => 0),
  },
}));

vi.mock('../services/energy/energyBaselineService.js', () => {
  class BaselineOverlapError extends Error {
    code = 'BASELINE_OVERLAP' as const;
    details = {};
  }
  class BaselinePredatesDataError extends Error {
    code = 'BASELINE_PREDATES_DATA' as const;
    details = {};
  }
  class BaselineTooShortError extends Error {
    code = 'BASELINE_TOO_SHORT' as const;
    details = { reason: 'window_too_short' };
  }
  class MeasurementTooShortError extends Error {
    code = 'MEASUREMENT_TOO_SHORT' as const;
    details = {};
  }
  class NoActiveBaselineError extends Error {
    code = 'NO_ACTIVE_BASELINE' as const;
    details = {};
  }
  return {
    BaselineOverlapError,
    BaselinePredatesDataError,
    BaselineTooShortError,
    MeasurementTooShortError,
    NoActiveBaselineError,
    EnergyBaselineService: {
      getActiveBaseline: vi.fn(async () => null),
      validateOldestDataAvailability: vi.fn(async () => undefined),
      lockBaseline: vi.fn(),
      getBaselineById: vi.fn(async () => null),
      retireBaseline: vi.fn(async () => undefined),
      computeSavings: vi.fn(),
    },
  };
});

vi.mock('../services/energy/energyDashboardService.js', () => ({
  EnergyDashboardService: {
    getDashboardSummary: getDashboardSummaryMock,
    getCycles: getCyclesMock,
    getReconciliation: getReconciliationMock,
  },
}));

const { energyRoutes } = await import('../routes/energy.js');

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('energy dashboard routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('requires auth for energy dashboard read routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/energy/dashboard?from=2026-04-01T00:00:00.000Z&to=2026-04-08T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(401);
    expect(getDashboardSummaryMock).not.toHaveBeenCalled();
  });

  it('GET /api/energy/cycles returns decoded grouped rows', async () => {
    getCyclesMock.mockResolvedValue({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-08T00:00:00.000Z',
      limit: 10,
      rows: [
        {
          cycleType: 3,
          cycleLabelKey: 'DRY_MIXED',
          cycleLabel: 'DRY MIXED',
          cycleCount: 8,
          totalKwh: 42,
          totalKg: 20,
          avgKwhPerKg: 2.1,
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/energy/cycles?from=2026-04-01T00:00:00.000Z&to=2026-04-08T00:00:00.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().rows[0]).toMatchObject({
      cycleLabelKey: 'DRY_MIXED',
      cycleLabel: 'DRY MIXED',
      cycleCount: 8,
    });
  });

  it('GET /api/energy/reconciliation returns meter/cycle/idle/unknown percentages', async () => {
    getReconciliationMock.mockResolvedValue({
      meterKwh: 100,
      cyclesKwh: 74,
      idleKwh: 24,
      unknownKwh: 2,
      cyclesPct: 74,
      idlePct: 24,
      unknownPct: 2,
      warning: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/energy/reconciliation?from=2026-04-01T00:00:00.000Z&to=2026-04-08T00:00:00.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      meterKwh: 100,
      cyclesPct: 74,
      idlePct: 24,
      unknownPct: 2,
    });
  });

  it('GET /api/energy/dashboard returns CLIENT-safe summary', async () => {
    getDashboardSummaryMock.mockResolvedValue({
      currentPowerKw: 12.8,
      dayToDateKwh: 42,
      dayToDateEur: 10.5,
      dayToDateKgCo2: 11,
      cyclesToday: 5,
      savings: null,
      savingsUnavailableReason: 'NO_ACTIVE_BASELINE',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/energy/dashboard?from=2026-04-01T00:00:00.000Z&to=2026-04-08T00:00:00.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      currentPowerKw: 12.8,
      cyclesToday: 5,
      savingsUnavailableReason: 'NO_ACTIVE_BASELINE',
    });
    expect(response.json().wptDetails).toBeUndefined();
  });

  it('GET /api/energy/dashboard returns WPT extra-detail shape', async () => {
    getDashboardSummaryMock.mockResolvedValue({
      currentPowerKw: 12.8,
      dayToDateKwh: 42,
      dayToDateEur: 10.5,
      dayToDateKgCo2: 11,
      cyclesToday: 5,
      savings: null,
      savingsUnavailableReason: 'NO_ACTIVE_BASELINE',
      wptDetails: {
        peakPowerKw: 16.4,
        baselineEnpi: 2.3,
        tariffBandKwh: { f1: 10, f2: 20, f3: 12 },
        rmsCurrentAvg: { l1: 9.1, l2: 9.4, l3: 9.6 },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/energy/dashboard?from=2026-04-01T00:00:00.000Z&to=2026-04-08T00:00:00.000Z',
      headers: { 'x-test-role': 'WPT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().wptDetails).toMatchObject({
      peakPowerKw: 16.4,
      tariffBandKwh: { f1: 10, f2: 20, f3: 12 },
    });
  });
});
