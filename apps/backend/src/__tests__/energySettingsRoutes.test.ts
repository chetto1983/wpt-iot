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
    await requireAuthMock(request, reply);
    if (reply.sent) return;
    if (request.session.role !== requiredRole) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  },
);

const getConfigMock = vi.fn();
const updateConfigMock = vi.fn();
const getActivePeriodMock = vi.fn();
const insertNewPeriodMock = vi.fn();

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

vi.mock('../services/machineAnomalyService.js', () => ({
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

vi.mock('../services/energyPdfService.js', () => ({
  EnergyPdfService: {
    generateIso50001Pdf: vi.fn(async () => Buffer.from('%PDF-1.4 settings-test')),
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
      getActiveBaseline: vi.fn(async () => null),
      validateOldestDataAvailability: vi.fn(async () => undefined),
      lockBaseline: vi.fn(),
      getBaselineById: vi.fn(async () => null),
      retireBaseline: vi.fn(async () => undefined),
      computeSavings: vi.fn(),
    },
  };
});

vi.mock('../services/energyConfigService.js', () => ({
  EnergyConfigService: {
    getConfig: getConfigMock,
    updateConfig: updateConfigMock,
    getActivePeriod: getActivePeriodMock,
    insertNewPeriod: insertNewPeriodMock,
  },
}));

const { energyRoutes } = await import('../routes/energy.js');

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes);
  await app.ready();
  return app;
}

describe('energy settings routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getConfigMock.mockResolvedValue({
      id: 1,
      customerName: 'WPT Demo',
      machineSerial: 'SER-001',
      machineModel: 'Dryer X',
      installSite: 'Bergamo',
      cosphi: 0.85,
      shiftStartHour: 6,
      updatedAt: new Date('2026-04-10T12:00:00.000Z'),
    });
    updateConfigMock.mockResolvedValue({
      id: 1,
      customerName: 'WPT Demo',
      machineSerial: 'SER-001',
      machineModel: 'Dryer X',
      installSite: 'Bergamo',
      cosphi: 0.85,
      shiftStartHour: 6,
      updatedAt: new Date('2026-04-10T12:00:00.000Z'),
    });
    getActivePeriodMock.mockResolvedValue({
      id: 9,
      validFrom: new Date('2026-04-10T00:00:00.000Z'),
      validTo: null,
      emissionFactorKgPerKwh: 0.279,
      emissionFactorYear: 2026,
      emissionFactorSource: 'ISPRA',
      tariffMode: 'single',
      tariffSingleEurPerKwh: 0.25,
      tariffBandsJson: {},
      customHolidays: [],
      createdAt: new Date('2026-04-10T00:00:00.000Z'),
    });
    insertNewPeriodMock.mockResolvedValue(undefined);
    app = await buildTestServer();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/energy/config requires SUPER_ADMIN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/energy/config',
      headers: { 'x-test-role': 'WPT' },
    });

    expect(response.statusCode).toBe(403);
    expect(getConfigMock).not.toHaveBeenCalled();
    expect(getActivePeriodMock).not.toHaveBeenCalled();
  });

  it('PUT /api/energy/config validates emission factor range', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        customerName: 'WPT Demo',
        machineSerial: 'SER-001',
        machineModel: 'Dryer X',
        installSite: 'Bergamo',
        cosphi: 0.85,
        shiftStartHour: 6,
        effectiveFrom: '2026-04-10T00:00:00.000Z',
        emissionFactorKgPerKwh: 2.1,
        emissionFactorYear: 2026,
        emissionFactorSource: 'ISPRA',
        tariffMode: 'single',
        tariffSingleEurPerKwh: 0.25,
        tariffBandsJson: {},
      },
    });

    expect(response.statusCode).toBe(400);
    expect(updateConfigMock).not.toHaveBeenCalled();
    expect(insertNewPeriodMock).not.toHaveBeenCalled();
  });

  it('PUT /api/energy/config appends a new tariff/emission period instead of mutating history', async () => {
    const effectiveFrom = '2026-05-01T00:00:00.000Z';
    updateConfigMock.mockResolvedValue({
      id: 1,
      customerName: 'Updated Demo',
      machineSerial: 'SER-009',
      machineModel: 'Dryer XL',
      installSite: 'Brescia',
      cosphi: 0.9,
      shiftStartHour: 7,
      updatedAt: new Date('2026-04-10T13:00:00.000Z'),
    });
    getActivePeriodMock.mockResolvedValue({
      id: 10,
      validFrom: new Date(effectiveFrom),
      validTo: null,
      emissionFactorKgPerKwh: 0.3,
      emissionFactorYear: 2026,
      emissionFactorSource: 'ARERA',
      tariffMode: 'tou3',
      tariffSingleEurPerKwh: 0.28,
      tariffBandsJson: {
        f1: { eurPerKwh: 0.31 },
        f2: { eurPerKwh: 0.24 },
        f3: { eurPerKwh: 0.19 },
      },
      customHolidays: [],
      createdAt: new Date('2026-04-10T13:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        customerName: 'Updated Demo',
        machineSerial: 'SER-009',
        machineModel: 'Dryer XL',
        installSite: 'Brescia',
        cosphi: 0.9,
        shiftStartHour: 7,
        effectiveFrom,
        emissionFactorKgPerKwh: 0.3,
        emissionFactorYear: 2026,
        emissionFactorSource: 'ARERA',
        tariffMode: 'tou3',
        tariffSingleEurPerKwh: 0.28,
        tariffBandsJson: {
          f1: { eurPerKwh: 0.31 },
          f2: { eurPerKwh: 0.24 },
          f3: { eurPerKwh: 0.19 },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updateConfigMock).toHaveBeenCalledWith({
      customerName: 'Updated Demo',
      machineSerial: 'SER-009',
      machineModel: 'Dryer XL',
      installSite: 'Brescia',
      cosphi: 0.9,
      shiftStartHour: 7,
    });
    expect(insertNewPeriodMock).toHaveBeenCalledWith({
      validFrom: new Date(effectiveFrom),
      validTo: null,
      emissionFactorKgPerKwh: 0.3,
      emissionFactorYear: 2026,
      emissionFactorSource: 'ARERA',
      tariffMode: 'tou3',
      tariffSingleEurPerKwh: 0.28,
      tariffBandsJson: {
        f1: { eurPerKwh: 0.31 },
        f2: { eurPerKwh: 0.24 },
        f3: { eurPerKwh: 0.19 },
      },
      customHolidays: [],
    });
    expect(getActivePeriodMock).toHaveBeenCalledWith(new Date(effectiveFrom));
    expect(response.json()).toMatchObject({
      config: {
        customerName: 'Updated Demo',
        machineSerial: 'SER-009',
      },
      activePeriod: {
        tariffMode: 'tou3',
        emissionFactorSource: 'ARERA',
      },
    });
  });

  it.todo('POST sample report route/path reuses the existing PDF route contract');
});
