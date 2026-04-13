import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import type * as EnergyAttributionServiceModule from '../services/energyAttributionService.js';
import { EnergyBaselineService } from '../services/energyBaselineService.js';
import { EnergyConfigService } from '../services/energyConfigService.js';
import { assertReportReproducible, extractPdfText } from './energy/pdfReportTestUtils.js';

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

vi.mock('../services/energyAttributionService.js', async () => {
  const actual = await vi.importActual<typeof EnergyAttributionServiceModule>(
    '../services/energyAttributionService.js',
  );
  actual.EnergyAttributionService.detectAndPersistClosedCycles = vi.fn(async () => 0);
  return actual;
});

const {
  BASELINE_FROM,
  BASELINE_TO,
  MEASUREMENT_FROM,
  MEASUREMENT_TO,
  cleanupBaselineArea,
  seedCycleRecords,
  seedEnergyDayBuckets,
} = await import('./energy/baselineFixtures.js');
const { energyRoutes } = await import('../routes/energy.js');

const FIXTURE_PERIOD_START_ISO = '2024-06-01T00:00:00.000Z';
const DEFAULT_PERIOD_START_ISO = '2024-01-01T00:00:00.000Z';
const DEFAULT_EMISSION_FACTOR = 0.279;
const DEFAULT_TARIFF_SINGLE = 0.25;

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes);
  await app.ready();
  return app;
}

async function resetEnergyConfigFixtureState(): Promise<void> {
  await db.execute(sql`
    DELETE FROM energy_config_periods
    WHERE valid_from = ${FIXTURE_PERIOD_START_ISO}::timestamptz
  `);
  await db.execute(sql`
    UPDATE energy_config_periods
    SET
      valid_to = NULL,
      emission_factor_kg_per_kwh = ${DEFAULT_EMISSION_FACTOR},
      emission_factor_year = 2024,
      emission_factor_source = 'ISPRA',
      tariff_mode = 'single',
      tariff_single_eur_per_kwh = ${DEFAULT_TARIFF_SINGLE},
      tariff_bands_json = '{}'::jsonb,
      custom_holidays = '[]'::jsonb
    WHERE valid_from = ${DEFAULT_PERIOD_START_ISO}::timestamptz
  `);
  await db.execute(sql`
    UPDATE energy_config
    SET
      customer_name = '',
      machine_serial = '',
      machine_model = '',
      install_site = '',
      cosphi = 0.85,
      shift_start_hour = 6,
      updated_at = NOW()
    WHERE id = 1
  `);
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes('ECONNREFUSED') ||
    JSON.stringify(error).includes('ECONNREFUSED')
  );
}

async function cleanupFixtureState(): Promise<void> {
  try {
    await cleanupBaselineArea();
    await resetEnergyConfigFixtureState();
  } catch (error) {
    if (!isConnectionRefused(error)) {
      throw error;
    }
  }
}

describe('energy milestone e2e', () => {
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    await EnergyBaselineService.ensureSchema();
    await EnergyConfigService.ensureTable();
    await cleanupFixtureState();
    app = await buildTestServer();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    await cleanupFixtureState();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it('configure settings -> lock baseline -> drive deterministic cycle data -> verify dashboard + cycles + reconciliation -> generate PDF twice and compare byte-identical buffers', async () => {
    const configuredCustomer = 'Milestone Fixture Customer';
    const configuredSerial = 'SER-E2E-23';
    const configuredSite = 'Remote PLC bench';
    const configuredEmissionSource = 'Fixture Grid 2024';
    const baselineLabel = 'Phase 23 baseline';
    const knownFixtureKwhPerCycle = 10;

    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });
    await seedEnergyDayBuckets({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      totalKwh: 290,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    const configResponse = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        customerName: configuredCustomer,
        machineSerial: configuredSerial,
        machineModel: 'Dryer XL',
        installSite: configuredSite,
        cosphi: 0.9,
        shiftStartHour: 6,
        effectiveFrom: FIXTURE_PERIOD_START_ISO,
        emissionFactorKgPerKwh: 0.31,
        emissionFactorYear: 2024,
        emissionFactorSource: configuredEmissionSource,
        tariffMode: 'single',
        tariffSingleEurPerKwh: 0.27,
        tariffBandsJson: {},
      },
    });
    expect(configResponse.statusCode).toBe(200);
    expect(configResponse.json()).toMatchObject({
      config: {
        customerName: configuredCustomer,
        machineSerial: configuredSerial,
        installSite: configuredSite,
      },
      activePeriod: {
        emissionFactorSource: configuredEmissionSource,
        tariffMode: 'single',
      },
    });

    const currentConfigResponse = await app.inject({
      method: 'GET',
      url: '/api/energy/config',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });
    expect(currentConfigResponse.statusCode).toBe(200);
    expect(currentConfigResponse.json()).toMatchObject({
      config: {
        customerName: configuredCustomer,
        machineSerial: configuredSerial,
      },
      activePeriod: {
        validFrom: FIXTURE_PERIOD_START_ISO,
      },
    });

    const baselineResponse = await app.inject({
      method: 'POST',
      url: '/api/energy/baseline/lock',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
      payload: {
        label: baselineLabel,
        periodFrom: BASELINE_FROM.toISOString(),
        periodTo: BASELINE_TO.toISOString(),
        justification: 'Phase 23 deterministic milestone proof',
        normalizationVariables: { ambientTempC: 21 },
      },
    });
    expect(baselineResponse.statusCode).toBe(201);
    const baselineBody = baselineResponse.json() as {
      baseline: { baselineId: number; label: string };
      evidence: { totalKwh: number; totalKg: number; enpi: number };
      warnings: string[];
    };
    const baselineId = baselineBody.baseline.baselineId;
    expect(baselineId).toBeGreaterThan(0);
    expect(baselineBody.baseline.label).toBe(baselineLabel);
    expect(baselineBody.evidence.totalKwh).toBeGreaterThan(0);
    expect(baselineBody.evidence.totalKg).toBeGreaterThan(0);
    expect(baselineBody.evidence.enpi).toBeGreaterThan(0);

    const dashboardResponse = await app.inject({
      method: 'GET',
      url: `/api/energy/dashboard?from=${encodeURIComponent(
        MEASUREMENT_FROM.toISOString(),
      )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}`,
      headers: { 'x-test-role': 'WPT' },
    });
    expect(dashboardResponse.statusCode).toBe(200);
    expect(dashboardResponse.json()).toMatchObject({
      wptDetails: {
        baselineEnpi: baselineBody.evidence.enpi,
      },
    });

    const cyclesResponse = await app.inject({
      method: 'GET',
      url: `/api/energy/cycles?from=${encodeURIComponent(
        MEASUREMENT_FROM.toISOString(),
      )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}&limit=10`,
      headers: { 'x-test-role': 'WPT' },
    });
    expect(cyclesResponse.statusCode).toBe(200);
    const cyclesBody = cyclesResponse.json() as {
      rows: Array<{
        cycleCount: number;
        totalKwh: number;
        totalKg: number;
        avgKwhPerKg: number | null;
      }>;
    };
    expect(cyclesBody.rows).toHaveLength(1);
    const cycleRow = cyclesBody.rows[0]!;
    const observedKwhPerCycle = cycleRow.totalKwh / cycleRow.cycleCount;
    expect(cycleRow.cycleCount).toBe(29);
    expect(cycleRow.totalKg).toBeCloseTo(580, 3);
    expect(cycleRow.avgKwhPerKg).toBeCloseTo(0.5, 3);
    // Per-cycle kWh must stay within +/-2% of the known fixture input.
    expect(observedKwhPerCycle).toBeGreaterThanOrEqual(knownFixtureKwhPerCycle * 0.98);
    expect(observedKwhPerCycle).toBeLessThanOrEqual(knownFixtureKwhPerCycle * 1.02);

    const reconciliationResponse = await app.inject({
      method: 'GET',
      url: `/api/energy/reconciliation?from=${encodeURIComponent(
        MEASUREMENT_FROM.toISOString(),
      )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}`,
      headers: { 'x-test-role': 'WPT' },
    });
    expect(reconciliationResponse.statusCode).toBe(200);
    const reconciliationBody = reconciliationResponse.json() as {
      meterKwh: number;
      cyclesKwh: number;
      unknownPct: number;
      wptDetails?: { accountedRatio: number };
    };
    expect(reconciliationBody.meterKwh).toBeGreaterThan(0);
    expect(reconciliationBody.cyclesKwh).toBeGreaterThan(0);
    expect(reconciliationBody.wptDetails?.accountedRatio ?? 0).toBeGreaterThan(0.98);
    expect(reconciliationBody.unknownPct).toBeLessThan(2);

    const pdfUrl = `/api/energy/reports/iso50001/pdf?from=${encodeURIComponent(
      MEASUREMENT_FROM.toISOString(),
    )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}&lang=en&baseline_id=${baselineId}`;
    const firstPdfResponse = await app.inject({
      method: 'POST',
      url: pdfUrl,
      headers: { 'x-test-role': 'WPT' },
    });
    const secondPdfResponse = await app.inject({
      method: 'POST',
      url: pdfUrl,
      headers: { 'x-test-role': 'WPT' },
    });

    if (firstPdfResponse.statusCode !== 200 || secondPdfResponse.statusCode !== 200) {
      let pdfErrorMessage = 'unknown';
      try {
        const { EnergyPdfService } = await import('../services/energyPdfService.js');
        await EnergyPdfService.generateIso50001Pdf({
          from: MEASUREMENT_FROM,
          to: MEASUREMENT_TO,
          lang: 'en',
          baselineId,
        });
      } catch (error) {
        pdfErrorMessage = error instanceof Error ? error.message : String(error);
      }
      throw new Error(
        `PDF route failed: first=${firstPdfResponse.statusCode} body=${firstPdfResponse.body}; second=${secondPdfResponse.statusCode} body=${secondPdfResponse.body}; service=${pdfErrorMessage}`,
      );
    }
    expect(firstPdfResponse.headers['content-type']).toContain('application/pdf');
    expect(secondPdfResponse.headers['content-type']).toContain('application/pdf');

    const firstPdf = (firstPdfResponse as unknown as { rawPayload: Buffer }).rawPayload;
    const secondPdf = (secondPdfResponse as unknown as { rawPayload: Buffer }).rawPayload;

    expect(Buffer.isBuffer(firstPdf)).toBe(true);
    expect(Buffer.isBuffer(secondPdf)).toBe(true);
    assertReportReproducible(firstPdf, secondPdf);

    const pdfText = await extractPdfText(firstPdf);
    expect(pdfText).toContain(baselineLabel);
    expect(pdfText).toContain(configuredEmissionSource);
  });
});
