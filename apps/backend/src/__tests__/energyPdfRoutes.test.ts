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
  (requiredRole: string) => async (request: any, reply: any) => {
    const role = request.headers['x-test-role'];
    if (role !== requiredRole) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    request.session = { role };
  },
);

const getActiveBaselineMock = vi.fn();
const generateIso50001PdfMock = vi.fn();

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

vi.mock('../services/energyAttributionService.js', () => ({
  EnergyAttributionService: {
    detectAndPersistClosedCycles: vi.fn(async () => 0),
  },
}));

vi.mock('../services/energyAggregateService.js', () => ({
  EnergyAggregateService: {
    getAggregate: vi.fn(),
  },
}));

vi.mock('../services/energyDashboardService.js', () => ({
  EnergyDashboardService: {
    getDashboardSummary: vi.fn(),
    getCycles: vi.fn(),
    getReconciliation: vi.fn(),
  },
}));

vi.mock('../services/energyBaselineService.js', () => {
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
      getActiveBaseline: getActiveBaselineMock,
      validateOldestDataAvailability: vi.fn(async () => undefined),
      lockBaseline: vi.fn(),
      getBaselineById: vi.fn(async () => null),
      retireBaseline: vi.fn(async () => undefined),
      computeSavings: vi.fn(),
    },
  };
});

vi.mock('../services/energyPdfService.js', () => ({
  EnergyPdfService: {
    generateIso50001Pdf: generateIso50001PdfMock,
  },
}));

const { energyRoutes } = await import('../routes/energy.js');

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes);
  await app.ready();
  return app;
}

describe('energy pdf report route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getActiveBaselineMock.mockResolvedValue({ baselineId: 7 });
    generateIso50001PdfMock.mockResolvedValue(Buffer.from('%PDF-1.4 route-test'));
    app = await buildTestServer();
    getActiveBaselineMock.mockClear();
    generateIso50001PdfMock.mockClear();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('requires auth for POST /api/energy/reports/iso50001/pdf', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/energy/reports/iso50001/pdf?from=2026-04-01T00:00:00.000Z&to=2026-04-08T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(401);
    expect(generateIso50001PdfMock).not.toHaveBeenCalled();
  });

  it('returns application/pdf and bypasses active-baseline lookup when baseline_id is explicit', async () => {
    const from = '2026-04-01T00:00:00.000Z';
    const to = '2026-04-08T00:00:00.000Z';

    const response = await app.inject({
      method: 'POST',
      url: `/api/energy/reports/iso50001/pdf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&lang=en&baseline_id=11`,
      headers: { 'x-test-role': 'WPT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('energy-iso50001-baseline-11');
    expect(response.headers['content-disposition']).toContain(from);
    expect(response.headers['content-disposition']).toContain(to);
    expect(response.headers['content-disposition']).toContain('en');
    expect(getActiveBaselineMock).not.toHaveBeenCalled();
    expect(generateIso50001PdfMock).toHaveBeenCalledWith({
      from: new Date(from),
      to: new Date(to),
      lang: 'en',
      baselineId: 11,
    });
  });

  it('resolves the active baseline exactly once and includes it in the filename when baseline_id is absent', async () => {
    const from = '2026-04-03T00:00:00.000Z';
    const to = '2026-04-09T00:00:00.000Z';

    const response = await app.inject({
      method: 'POST',
      url: `/api/energy/reports/iso50001/pdf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&lang=it`,
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('energy-iso50001-baseline-7');
    expect(response.headers['content-disposition']).toContain(from);
    expect(response.headers['content-disposition']).toContain(to);
    expect(response.headers['content-disposition']).toContain('it');
    expect(getActiveBaselineMock).toHaveBeenCalledTimes(1);
    expect(generateIso50001PdfMock).toHaveBeenCalledWith({
      from: new Date(from),
      to: new Date(to),
      lang: 'it',
      baselineId: 7,
    });
  });
});
