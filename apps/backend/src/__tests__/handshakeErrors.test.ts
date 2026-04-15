/**
 * Tests for mapHandshakeError (routes/_util/handshake-errors.ts).
 *
 * Covers all 4 branches of the error mapping function:
 *   1. PlcConfigUnavailableError(NOT_CONFIGURED) → 503
 *   2. PlcConfigUnavailableError(DB_UNREACHABLE) → 503
 *   3. Error with 'Handshake in progress' message → 409
 *   4. Error with 'Handshake timeout' message → 504
 *   5. Unknown Error → 500 + log.error
 *   6. Non-Error input (null) → 500
 *
 * Plus 1 integration test for the PUT /plc/config localhost rejection guard:
 *   7. { targetHost: 'localhost' } → 400
 */
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mapHandshakeError } from '../routes/_util/handshake-errors.js';
import { PlcConfigUnavailableError } from '../udp/plcConfigService.js';

// ---------------------------------------------------------------------------
// Mock requireRole so the PUT /plc/config route is reachable without a real
// DB session (we only want to test Zod validation, not auth).
// ---------------------------------------------------------------------------
vi.mock('../auth/authHooks.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireRole: vi.fn(() => async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock PlcConfigService so the route import does not try to connect to a DB.
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
// Minimal FastifyReply mock for unit-testing mapHandshakeError
// ---------------------------------------------------------------------------
function makeReply() {
  const reply = {
    _code: 0,
    _body: null as unknown,
    code(n: number) { this._code = n; return this; },
    send(body: unknown) { this._body = body; return this; },
    log: { error: vi.fn() },
  };
  return reply;
}

// ---------------------------------------------------------------------------
// mapHandshakeError branch tests
// ---------------------------------------------------------------------------

describe('mapHandshakeError', () => {
  it('503 for PlcConfigUnavailableError NOT_CONFIGURED', () => {
    const reply = makeReply();
    mapHandshakeError(new PlcConfigUnavailableError('NOT_CONFIGURED'), reply as never);
    expect(reply._code).toBe(503);
    expect((reply._body as { error: string }).error.toLowerCase()).toContain('not configured');
  });

  it('503 for PlcConfigUnavailableError DB_UNREACHABLE', () => {
    const reply = makeReply();
    mapHandshakeError(new PlcConfigUnavailableError('DB_UNREACHABLE'), reply as never);
    expect(reply._code).toBe(503);
  });

  it('409 for Handshake in progress message', () => {
    const reply = makeReply();
    mapHandshakeError(new Error('Handshake in progress on users'), reply as never);
    expect(reply._code).toBe(409);
  });

  it('504 for Handshake timeout message', () => {
    const reply = makeReply();
    mapHandshakeError(
      new Error('Handshake timeout on users: no data within 5000ms'),
      reply as never,
    );
    expect(reply._code).toBe(504);
  });

  it('500 for unknown Error + log.error called', () => {
    const reply = makeReply();
    mapHandshakeError(new Error('ECONNREFUSED'), reply as never);
    expect(reply._code).toBe(500);
    expect(reply.log.error).toHaveBeenCalledOnce();
  });

  it('500 for non-Error input (null)', () => {
    const reply = makeReply();
    mapHandshakeError(null, reply as never);
    expect(reply._code).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /plc/config localhost rejection guard
// ---------------------------------------------------------------------------

describe('PUT /plc/config localhost rejection', () => {
  it('rejects targetHost = "localhost" with 400', async () => {
    const { plcConfigRoutes } = await import('../routes/plcConfig.js');
    const app = Fastify({ logger: false });
    await app.register(plcConfigRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/plc/config',
      payload: { targetHost: 'localhost' },
    });

    expect(response.statusCode).toBe(400);
  });
});
