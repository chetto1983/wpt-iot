import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * PHASE 24 Wave 0 — /api/cycles REST API routes test scaffold.
 *
 * Per CONTEXT D-05: Backend routes for cycle register page.
 *
 * Endpoints to test:
 *   - GET /api/cycles — paginated cycle records
 *   - GET /api/cycles/export?format=csv — CSV download
 *   - GET /api/cycles/export?format=pdf — PDF download
 *
 * Query params:
 *   - from, to — date range (ISO datetime)
 *   - page — pagination offset
 *   - limit — page size
 *   - sort — column to sort by
 *   - order — asc/desc
 *
 * Access control:
 *   - CLIENT: can view, cannot export
 *   - SUPER_ADMIN: can view and export
 *
 * All tests currently FAIL (RED phase) — implementation in Wave 3.
 */

// ---------------------------------------------------------------------------
// Mocks for auth hooks (hoisted)
// ---------------------------------------------------------------------------
const requireAuthMock = vi.fn(async (request: any, reply: any) => {
  const role = request.headers['x-test-role'];
  if (!role) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  request.session = { role, userId: 'test-user' };
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

// Mock cycle service
const getCyclesMock = vi.fn();
const exportCsvMock = vi.fn();
const exportPdfMock = vi.fn();

vi.mock('../../auth/authHooks.js', () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock,
}));

vi.mock('../../services/cycleService.js', () => ({
  CycleService: {
    getCycles: getCyclesMock,
    exportCsv: exportCsvMock,
    exportPdf: exportPdfMock,
  },
}));

// Import routes after mocks
const { cycleRoutes } = await import('../../routes/cycles.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cycleRoutes);
  await app.ready();
  return app;
}

function makeCycleRecord(overrides: Record<string, unknown> = {}) {
  return {
    cycleNumber: 11,
    startedAt: '2026-04-10T08:00:00.000Z',
    endedAt: '2026-04-10T08:30:00.000Z',
    cycleType: 3,
    cycleStatusLabel: 'OK',
    materialInputKg: 100,
    materialOutputKg: 80,
    containers: 13,
    grossInputKg: 100,
    startEnergyKwh: 1250.5,
    endEnergyKwh: 1280.5,
    startWaterL: 45.2,
    endWaterL: 52.5,
    operator: 'MARIO ROSSI',
    orderNumber: 'ORD-2026-001',
    ...overrides,
  };
}

describe('/api/cycles routes (RED — Phase 24)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
  });

  // ==========================================================================
  // Test 1: GET /api/cycles returns paginated cycle records
  // ==========================================================================
  it('GET /api/cycles returns paginated cycle records', async () => {
    getCyclesMock.mockResolvedValue({
      data: [makeCycleRecord(), makeCycleRecord({ cycleNumber: 12 })],
      pagination: {
        page: 1,
        limit: 25,
        total: 100,
        totalPages: 4,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&page=1&limit=25',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 100,
      totalPages: 4,
    });
  });

  // ==========================================================================
  // Test 2: GET /api/cycles validates date range parameters
  // ==========================================================================
  it('GET /api/cycles validates date range parameters (422 on invalid)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=invalid-date&to=2026-04-30T23:59:59.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toContain('Invalid date format');
  });

  it('GET /api/cycles validates date range (from must be before to)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-30T00:00:00.000Z&to=2026-04-01T00:00:00.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('from must be before to');
  });

  // ==========================================================================
  // Test 3: GET /api/cycles supports sorting by column
  // ==========================================================================
  it('GET /api/cycles supports sorting by column', async () => {
    getCyclesMock.mockResolvedValue({
      data: [
        makeCycleRecord({ cycleNumber: 12, startedAt: '2026-04-10T10:00:00.000Z' }),
        makeCycleRecord({ cycleNumber: 11, startedAt: '2026-04-10T08:00:00.000Z' }),
      ],
      pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
    });

    // Sort by startedAt ascending
    const responseAsc = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&sort=startedAt&order=asc',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(responseAsc.statusCode).toBe(200);
    const bodyAsc = responseAsc.json();
    expect(bodyAsc.data[0].cycleNumber).toBe(11); // First chronologically

    // Sort by startedAt descending
    getCyclesMock.mockResolvedValue({
      data: [
        makeCycleRecord({ cycleNumber: 12, startedAt: '2026-04-10T10:00:00.000Z' }),
        makeCycleRecord({ cycleNumber: 11, startedAt: '2026-04-10T08:00:00.000Z' }),
      ],
      pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
    });

    const responseDesc = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&sort=startedAt&order=desc',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(responseDesc.statusCode).toBe(200);
    const bodyDesc = responseDesc.json();
    expect(bodyDesc.data[0].cycleNumber).toBe(12); // Most recent first
  });

  // ==========================================================================
  // Test 4: GET /api/cycles/export?format=csv returns CSV download
  // ==========================================================================
  it('GET /api/cycles/export?format=csv returns CSV download with correct headers', async () => {
    exportCsvMock.mockResolvedValue({
      content: 'Ciclo,Data,Operatore\n11,10/04/2026,MARIO ROSSI\n',
      filename: 'registro_cicli_2026_04.csv',
      contentType: 'text/csv; charset=utf-8',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles/export?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&format=csv',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('registro_cicli_2026_04.csv');
  });

  // ==========================================================================
  // Test 5: GET /api/cycles/export?format=pdf returns PDF download
  // ==========================================================================
  it('GET /api/cycles/export?format=pdf returns PDF download with correct headers', async () => {
    exportPdfMock.mockResolvedValue({
      content: Buffer.from('pdf-content'),
      filename: 'registro_cicli_2026_04.pdf',
      contentType: 'application/pdf',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles/export?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&format=pdf',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toContain('registro_cicli_2026_04.pdf');
  });

  // ==========================================================================
  // Test 6: Unauthorized requests return 401
  // ==========================================================================
  it('Unauthorized requests return 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z',
      // No auth header
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'Unauthorized' });
  });

  // ==========================================================================
  // Test 7: CLIENT role cannot access export endpoint (403 Forbidden)
  // ==========================================================================
  it('CLIENT role cannot access export endpoint (returns 403)', async () => {
    const responseCsv = await app.inject({
      method: 'GET',
      url: '/api/cycles/export?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&format=csv',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(responseCsv.statusCode).toBe(403);

    const responsePdf = await app.inject({
      method: 'GET',
      url: '/api/cycles/export?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&format=pdf',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(responsePdf.statusCode).toBe(403);
  });

  // ==========================================================================
  // Test 8: Date range filtering uses [from, to) half-open interval
  // ==========================================================================
  it('Date range filtering uses [from, to) half-open interval', async () => {
    getCyclesMock.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
    });

    await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-10T08:00:00.000Z&to=2026-04-10T09:00:00.000Z',
      headers: { 'x-test-role': 'CLIENT' },
    });

    // Verify service was called with correct date range
    expect(getCyclesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '2026-04-10T08:00:00.000Z',
        to: '2026-04-10T09:00:00.000Z',
      }),
    );
  });

  // ==========================================================================
  // Test 9: Invalid sort column returns 422
  // ==========================================================================
  it('Invalid sort column returns 422 validation error', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&sort=invalidColumn',
      headers: { 'x-test-role': 'CLIENT' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('Invalid sort column');
  });

  // ==========================================================================
  // Test 10: Export with invalid format returns 400
  // ==========================================================================
  it('Export with invalid format returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/cycles/export?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z&format=xml',
      headers: { 'x-test-role': 'SUPER_ADMIN' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('format');
  });
});
