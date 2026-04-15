/**
 * Integration tests for POST /api/plc/test-connection route.
 *
 * Covers the two expected paths:
 *   1. readUsers resolves → { ok: true, durationMs: number }, HTTP 200
 *   2. readUsers throws  → { ok: false, error: string },       HTTP 200
 *
 * Both paths must return HTTP 200 — the error is an expected operational
 * outcome (PLC unreachable), not an HTTP failure.
 *
 * Mocks:
 *   - getSockets: returns stub objects (dgram.Socket shape not needed — readUsers is also mocked)
 *   - readUsers: controlled per test via mockReadUsers
 *   - requireRole: bypassed so auth does not require a real DB session
 *   - PlcConfigService: stubbed so GET/PUT routes don't require a DB connection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Mock requireRole so auth is bypassed in all route tests
// ---------------------------------------------------------------------------
vi.mock('../auth/authHooks.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireRole: vi.fn(() => async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock PlcConfigService so GET/PUT routes don't attempt a DB connection
// ---------------------------------------------------------------------------
vi.mock('../udp/plcConfigService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../udp/plcConfigService.js')>();
  return {
    ...actual,
    PlcConfigService: {
      getConfig: vi.fn(async () => ({ id: 1, targetHost: '192.168.0.10', updatedAt: new Date() })),
      updateConfig: vi.fn(async () => ({ id: 1, targetHost: '192.168.0.10', updatedAt: new Date() })),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock getSockets — returns fake socket objects; real dgram.Socket shape is
// irrelevant because readUsers is also mocked.
// ---------------------------------------------------------------------------
vi.mock('../udp/sockets.js', () => ({
  getSockets: vi.fn(() => ({
    ackSocket: {},
    userSocket: {},
    dataSocket: {},
    alarmSocket: {},
  })),
}));

// ---------------------------------------------------------------------------
// Mock readUsers — controlled per test
// ---------------------------------------------------------------------------
const mockReadUsers = vi.fn();
vi.mock('../udp/handshakeFsm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../udp/handshakeFsm.js')>();
  return { ...actual, readUsers: mockReadUsers };
});

// ---------------------------------------------------------------------------
// Import route plugin after mocks are set up
// ---------------------------------------------------------------------------
const { plcConfigRoutes } = await import('../routes/plcConfig.js');

// ---------------------------------------------------------------------------
// Shared test app factory
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(plcConfigRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /plc/test-connection', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns ok:true and durationMs when readUsers resolves', async () => {
    mockReadUsers.mockResolvedValue([]);

    const response = await app.inject({
      method: 'POST',
      url: '/plc/test-connection',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; durationMs: number };
    expect(body.ok).toBe(true);
    expect(typeof body.durationMs).toBe('number');
  });

  it('returns ok:false and error string when readUsers throws', async () => {
    mockReadUsers.mockRejectedValue(
      new Error('Handshake timeout on users: no data within 5000ms'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/plc/test-connection',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; error: string; durationMs: number };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('timeout');
    expect(typeof body.durationMs).toBe('number');
  });
});
