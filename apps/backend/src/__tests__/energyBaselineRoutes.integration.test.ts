/**
 * Phase 20 — energy baseline HTTP route integration tests:
 * POST baseline/lock, POST baseline/:id/retire, GET savings + error mapping.
 * Service-layer coverage lives in energyBaseline.integration.test.ts.
 *
 * Test names are VERBATIM from 20-VALIDATION.md `-t` filter strings.
 * Do not rename without re-syncing VALIDATION.md.
 *
 * Prereq: `cd wpt-iot && docker compose up -d db` before running.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { EnergyBaselineService, EnergyConfigService } from '../services/energy/index.js';
import {
  BASELINE_FROM,
  BASELINE_TO,
  MEASUREMENT_FROM,
  MEASUREMENT_TO,
  cleanupBaselineArea,
  seedCycleRecords,
  seedEnergyDayBuckets,
  setupEnergyAggregates,
} from './energy/baselineFixtures.js';

// Auth is bypassed in this integration test so POST /baseline/lock and
// GET /savings routes hit the real service layer instead of 401/500-ing
// on the missing session cookie. The Phase 20 route handlers gate on
// requireRole(SUPER_ADMIN); for this integration test we inject a fake
// SUPER_ADMIN session directly.
vi.mock('../auth/authHooks.js', () => ({
  requireAuth: async (request: any): Promise<void> => {
    request.session = { userId: 1, role: 'SUPER_ADMIN' };
  },
  requireRole: () => async (request: any): Promise<void> => {
    request.session = { userId: 1, role: 'SUPER_ADMIN' };
  },
}));

const { energyRoutes } = await import('../routes/energy.js');

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(energyRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('energyBaseline routes integration', () => {
  beforeAll(async () => {
    await setupEnergyAggregates();
  });

  beforeEach(async () => {
    await EnergyBaselineService.ensureSchema();
    await EnergyConfigService.ensureTable();
    await cleanupBaselineArea();
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it('POST baseline/lock happy path', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'route-test baseline',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          justification: 'happy path',
          normalizationVariables: { temp: 20 },
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        baseline: { baselineId: number };
        evidence: { totalKwh: number };
        warnings: string[];
      };
      expect(body.baseline.baselineId).toBeGreaterThan(0);
      expect(body.evidence.totalKwh).toBeGreaterThan(0);
      expect(Array.isArray(body.warnings)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('POST baseline/lock 422 on overlap and short window', async () => {
    const app = await buildTestServer();
    try {
      // 10-day window in 2024 (past, so the future-date guard does not fire) → too short (< 14 days)
      const response = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'too-short',
          periodFrom: new Date('2024-04-01T00:00:00Z').toISOString(),
          periodTo: new Date('2024-04-10T00:00:00Z').toISOString(),
          normalizationVariables: {},
        },
      });
      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        error: { code: string; message: string; details: { reason?: string } };
      };
      expect(body.error.code).toBe('BASELINE_TOO_SHORT');
      // BaselineTooShortError details.reason discriminator (WARNING 2)
      expect(body.error.details.reason).toBe('window_too_short');
    } finally {
      await app.close();
    }
  });

  it('POST baseline/:id/retire returns 204', async () => {
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      // Lock first
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'retire-route-test',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: {},
        },
      });
      expect(lockRes.statusCode).toBe(201);
      const baselineId = (
        lockRes.json() as { baseline: { baselineId: number } }
      ).baseline.baselineId;

      // Retire
      const retireRes = await app.inject({
        method: 'POST',
        url: `/api/energy/baseline/${baselineId}/retire`,
      });
      expect(retireRes.statusCode).toBe(204);

      // Retire nonexistent → 404
      const notFoundRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/999999/retire',
      });
      expect(notFoundRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET savings default', async () => {
    // Seed baseline + measurement windows.
    //
    // Baseline window: 30 days × 1 cycle × 20 kg = 600 kg,
    // 300 kWh → baselineEnpi = 0.5 kwh/kg.
    // Measurement window: 29 days × 1 cycle × 20 kg = 580 kg.
    // Target: -10% deltaPct → measurementEnpi = 0.45 → totalKwh = 580 * 0.45 = 261.
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
      totalKwh: 261,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      // Lock a baseline
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'savings-default',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: { temp: 20 },
        },
      });
      expect(lockRes.statusCode).toBe(201);

      // Request savings WITHOUT baseline_id (default resolution)
      const savingsRes = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}`,
      });
      expect(savingsRes.statusCode).toBe(200);
      const body = savingsRes.json() as {
        deltaPct: number;
        confidence: string;
        excludedStatuses: string[];
      };
      // 10% less energy for the same production → -10% deltaPct (within rounding)
      expect(body.deltaPct).toBeCloseTo(-10, 0);
      expect(body.confidence).toBe('HIGH');
      expect(body.excludedStatuses).toContain('ABORTED');
    } finally {
      await app.close();
    }
  });

  it('GET savings detail=1', async () => {
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
      totalKwh: 270,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'savings-detail',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: { temp: 20 },
        },
      });
      const baselineId = (
        lockRes.json() as { baseline: { baselineId: number } }
      ).baseline.baselineId;

      const savingsRes = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(
          MEASUREMENT_TO.toISOString(),
        )}&baseline_id=${baselineId}&detail=1`,
      });
      expect(savingsRes.statusCode).toBe(200);
      const body = savingsRes.json() as {
        dailySeries: Array<{
          date: string;
          baselineKwhPerKg: number;
          measurementKwhPerKg: number;
        }>;
      };
      expect(Array.isArray(body.dailySeries)).toBe(true);
      expect(body.dailySeries.length).toBeGreaterThan(0);
      // Every point has the constant baseline reference line
      const baselineRefs = new Set(body.dailySeries.map((p) => p.baselineKwhPerKg));
      expect(baselineRefs.size).toBe(1); // constant value across the series
    } finally {
      await app.close();
    }
  });

  it('GET savings 204', async () => {
    // beforeEach already wiped the rolling fixture wall and 2099+ baselines; no lock happens
    // in this test so getActiveBaseline() must return null and the route
    // must respond 204 with no body.
    const app = await buildTestServer();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(MEASUREMENT_TO.toISOString())}`,
      });
      expect(response.statusCode).toBe(204);
      // 204 MUST have no body
      expect(response.body).toBe('');
    } finally {
      await app.close();
    }
  });

  it('error code mapping', async () => {
    // GET /savings with a measurement window that overlaps the baseline →
    // 422 BASELINE_OVERLAP. Exercises the mapBaselineErrorToResponse helper.
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });

    const app = await buildTestServer();
    try {
      const lockRes = await app.inject({
        method: 'POST',
        url: '/api/energy/baseline/lock',
        payload: {
          label: 'overlap-mapping-test',
          periodFrom: BASELINE_FROM.toISOString(),
          periodTo: BASELINE_TO.toISOString(),
          normalizationVariables: {},
        },
      });
      const baselineId = (
        lockRes.json() as { baseline: { baselineId: number } }
      ).baseline.baselineId;

      // Measurement window that overlaps the baseline (same from date)
      const response = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          BASELINE_FROM.toISOString(),
        )}&to=${encodeURIComponent(
          new Date(BASELINE_FROM.getTime() + 20 * 86_400_000).toISOString(),
        )}&baseline_id=${baselineId}`,
      });
      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        error: { code: string; message: string; details: unknown };
      };
      expect(body.error.code).toBe('BASELINE_OVERLAP');
      expect(body.error.details).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('BASELINE_PREDATES_DATA via computeSavings returns 422', async () => {
    // Seed baseline window normally so lockBaseline's own validation passes
    await seedEnergyDayBuckets({ from: BASELINE_FROM, to: BASELINE_TO, totalKwh: 300 });
    await seedCycleRecords({
      from: BASELINE_FROM,
      to: BASELINE_TO,
      cyclesPerDay: 2,
      kgPerCycle: 20,
    });
    // Measurement window — 29 days in June 2024, past the baseline window
    await seedEnergyDayBuckets({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      totalKwh: 270,
    });
    await seedCycleRecords({
      from: MEASUREMENT_FROM,
      to: MEASUREMENT_TO,
      cyclesPerDay: 1,
      kgPerCycle: 20,
    });

    // Lock the baseline over the real seeded window (passes lockBaseline guards)
    const lockRes = await EnergyBaselineService.lockBaseline({
      label: 'predate-route-test',
      periodFrom: BASELINE_FROM,
      periodTo: BASELINE_TO,
      normalizationVariables: { temp: 20 },
    });
    const baselineId = lockRes.baseline.baselineId;

    // Manually rewind period_from to a date EARLIER than the oldest energy_1d
    // bucket. Read the current MIN(bucket_1d) at runtime so the test is
    // resilient to stale CAGG chunks that survive between test runs (the
    // beforeEach wall deletes machine_snapshots inside the rolling fixture wall and
    // 2099+, but cannot DELETE the CAGG directly). One day earlier makes the
    // "predates" check deterministic.
    const minRes = await db.execute(sql`
      SELECT MIN(bucket_1d) AS oldest FROM energy_1d
    `);
    const oldestRaw = (minRes.rows[0] as { oldest: string | Date | null } | undefined)?.oldest;
    expect(oldestRaw).not.toBeNull();
    const oldestBucket = oldestRaw instanceof Date ? oldestRaw : new Date(oldestRaw as string);
    const EARLIER = new Date(oldestBucket.getTime() - 86_400_000);
    await db.execute(sql`
      UPDATE energy_baselines
      SET period_from = ${EARLIER.toISOString()}::timestamptz
      WHERE baseline_id = ${baselineId}
    `);

    // The route should 422 BASELINE_PREDATES_DATA because the per-request
    // validateOldestDataAvailability inside computeSavings catches it
    const app = await buildTestServer();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/energy/savings?from=${encodeURIComponent(
          MEASUREMENT_FROM.toISOString(),
        )}&to=${encodeURIComponent(
          MEASUREMENT_TO.toISOString(),
        )}&baseline_id=${baselineId}`,
      });
      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        error: { code: string; details: unknown };
      };
      expect(body.error.code).toBe('BASELINE_PREDATES_DATA');
    } finally {
      await app.close();
      // Explicit cleanup — period_from may be outside the beforeEach cleanup
      // walls after the rewind.
      await db.execute(sql`DELETE FROM baseline_evidence WHERE baseline_id = ${baselineId}`);
      await db.execute(sql`DELETE FROM energy_baselines WHERE baseline_id = ${baselineId}`);
    }
  });
});
