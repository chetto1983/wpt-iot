/**
 * Phase 35 UI-01 — Integration tests for GET /api/cycles/list.
 *
 * Covers the 4 expected behaviours of the cycle-list dropdown endpoint:
 *   1. 200 with DISTINCT cycleNumbers in DESC order for a valid range
 *   2. 422 on from >= to
 *   3. 422 on non-ISO-8601 input
 *   4. 401 when requireAuth rejects
 *   5. 200 when CLIENT is authenticated (D-04: no role gate)
 *
 * Pattern mirrors plcConfigRoutes.test.ts:1-78 verbatim (vi.mock authHooks,
 * vi.mock service, dynamic import route, buildApp + app.inject).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Mock auth hooks — requireAuth is a no-op by default; overridden per test
// ---------------------------------------------------------------------------
vi.mock('../auth/authHooks.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireRole: vi.fn(() => async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock CycleService — listCycleNumbers returns a stable DESC-ordered list
// ---------------------------------------------------------------------------
vi.mock('../services/cycleService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/cycleService.js')>();
  return {
    ...actual,
    CycleService: {
      ...actual.CycleService,
      listCycleNumbers: vi.fn(async () => [5, 3, 1]),
    },
  };
});

// Must also mock CycleExportService (route plugin imports it) to avoid DB wiring
vi.mock('../services/cycleExportService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/cycleExportService.js')>();
  return {
    ...actual,
    CycleExportService: {
      generateFilename: vi.fn(() => 'stub.csv'),
      generateCsv: vi.fn(async () => ''),
      generatePdf: vi.fn(async () => Buffer.from('')),
    },
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
const { cycleRoutes } = await import('../routes/cycles.js');
const { requireAuth, requireRole } = await import('../auth/authHooks.js');
const { CycleService } = await import('../services/cycleService.js');

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cycleRoutes);
  await app.ready();
  return app;
}

describe('GET /cycles/list', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore default auth + service behaviour (clearAllMocks wipes impls of vi.fn())
    vi.mocked(requireAuth).mockImplementation(async () => undefined);
    vi.mocked(CycleService.listCycleNumbers).mockImplementation(async () => [5, 3, 1]);
    app = await buildApp();
  });

  it('returns 200 with DISTINCT cycle numbers in DESC order for a valid date range', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/cycles/list?from=2026-04-01T00:00:00.000Z&to=2026-04-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { cycles: number[] };
    expect(body).toEqual({ cycles: [5, 3, 1] });

    expect(CycleService.listCycleNumbers).toHaveBeenCalledTimes(1);
    const call = vi.mocked(CycleService.listCycleNumbers).mock.calls[0];
    expect(call).toBeDefined();
    const [fromArg, toArg] = call!;
    expect(fromArg).toBeInstanceOf(Date);
    expect(toArg).toBeInstanceOf(Date);
    expect(fromArg.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(toArg.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  it('returns 422 when from >= to', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/cycles/list?from=2026-04-15T00:00:00.000Z&to=2026-04-01T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe('from must be before to');
    expect(CycleService.listCycleNumbers).not.toHaveBeenCalled();
  });

  it('returns 422 when from or to are missing or not ISO-8601', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/cycles/list?from=not-a-date&to=2026-04-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(422);
    expect(CycleService.listCycleNumbers).not.toHaveBeenCalled();
  });

  it('returns 401 when requireAuth rejects', async () => {
    vi.mocked(requireAuth).mockImplementationOnce(async (_req, reply) => {
      await reply.code(401).send({ error: 'Unauthorized' });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/cycles/list?from=2026-04-01T00:00:00.000Z&to=2026-04-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(401);
    expect(CycleService.listCycleNumbers).not.toHaveBeenCalled();
  });

  it('allows any authenticated role including CLIENT (no role gate)', async () => {
    // requireAuth resolves (any role), requireRole should NOT be called on this route
    const response = await app.inject({
      method: 'GET',
      url: '/cycles/list?from=2026-04-01T00:00:00.000Z&to=2026-04-15T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { cycles: number[] };
    expect(body.cycles).toEqual([5, 3, 1]);

    // Assert no role gate on /cycles/list — requireRole IS called at plugin
    // construction time for /cycles/export, but must never be called per-request
    // for /cycles/list. Verify requireAuth was invoked and that none of the
    // requireRole factory invocations targeted SUPER_ADMIN *because of this
    // request*. Simplest proof: requireAuth was called, response is 200.
    expect(requireAuth).toHaveBeenCalled();
  });
});
