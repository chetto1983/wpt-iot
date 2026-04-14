/**
 * Phase 32-02: requireAuth and requireRole hook integration tests.
 *
 * Mounts minimal test routes that call the real hooks as preHandlers.
 * Uses app.inject() — no real HTTP connections.
 * TRUNCATE sessions, auth_users CASCADE in beforeEach for isolation.
 *
 * Cookie signing note (D-09 follow-up): @fastify/session signs the sessionId
 * before placing it in the Set-Cookie header. The raw UUID stored in the DB
 * must be wrapped in a signed cookie value for inject() headers.
 * We use the same Signer + secret as the test session plugin registration.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { requireAuth, requireRole } from '../auth/authHooks.js';
import { DrizzleSessionStore } from '../auth/sessionStore.js';
import {
  createClientUser,
  createWptUser,
  createSuperAdminUser,
} from './fixtures/testUsers.js';
import { createSessionForUser } from './fixtures/testSessions.js';

const TEST_SESSION_SECRET = 'test-secret-32-chars-minimum-here!';

/**
 * Sign a raw sessionId with the test secret so @fastify/session accepts it.
 * Mirrors the @fastify/cookie Signer.sign() algorithm:
 *   signedValue = rawId + '.' + hmac-sha256(rawId, secret).base64.stripPadding
 */
function makeSignedCookie(rawSessionId: string): string {
  const sig = createHmac('sha256', TEST_SESSION_SECRET)
    .update(rawSessionId)
    .digest('base64')
    .replace(/=/g, '');
  return `sessionId=${rawSessionId}.${sig}`;
}

let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });

  await instance.register(fastifyCookie);
  await instance.register(fastifySession, {
    secret: TEST_SESSION_SECRET,
    store: new DrizzleSessionStore(),
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 86_400_000,
      path: '/',
    },
    saveUninitialized: false,
  });

  instance.get('/protected', { preHandler: requireAuth }, async (request) => {
    return { role: request.session.role };
  });

  instance.get(
    '/role-wpt',
    { preHandler: requireRole('WPT', 'SUPER_ADMIN') },
    async (request) => {
      return { role: request.session.role };
    },
  );

  instance.get(
    '/role-super-admin',
    { preHandler: requireRole('SUPER_ADMIN') },
    async (request) => {
      return { role: request.session.role };
    },
  );

  instance.get(
    '/role-client-or-wpt',
    { preHandler: requireRole('CLIENT', 'WPT') },
    async (request) => {
      return { role: request.session.role };
    },
  );

  await instance.ready();
  return instance;
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE sessions, auth_users CASCADE`);
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await pool.end().catch(() => undefined);
});

describe('requireAuth', () => {
  it('rejects request with no session with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects request with unknown userId with 401', async () => {
    // The sessions FK prevents a session row with a missing user_id.
    // Instead: create a valid session, then delete the user + session via CASCADE,
    // then inject a signed cookie pointing to the deleted session ID.
    // The session store returns null (not found) → requireAuth → 401.
    const ghost = await createClientUser();
    const { sessionId } = await createSessionForUser(ghost.id);
    // CASCADE delete: remove session first, then user
    await db.execute(sql`DELETE FROM sessions WHERE id = ${sessionId}`);
    await db.execute(sql`DELETE FROM auth_users WHERE id = ${ghost.id}`);
    const cookie = makeSignedCookie(sessionId);
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(401);
  });

  it('allows request with valid session and sets role on request', async () => {
    const user = await createClientUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { role: string };
    expect(body.role).toBe('CLIENT');
  });

  it('re-reads role from DB on every request (D-03)', async () => {
    const user = await createWptUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);

    // Initial role
    const first = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { Cookie: cookie },
    });
    expect(first.statusCode).toBe(200);
    expect((JSON.parse(first.body) as { role: string }).role).toBe('WPT');

    // Promote user directly in DB
    await db.execute(
      sql`UPDATE auth_users SET role = 'SUPER_ADMIN' WHERE id = ${user.id}`,
    );

    // Second request must reflect the new DB role
    const second = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { Cookie: cookie },
    });
    expect(second.statusCode).toBe(200);
    expect((JSON.parse(second.body) as { role: string }).role).toBe('SUPER_ADMIN');
  });
});

describe('requireRole', () => {
  it('returns 403 when role does not match allowed list', async () => {
    const user = await createClientUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);
    const response = await app.inject({
      method: 'GET',
      url: '/role-wpt',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns 200 when role is in allowed list', async () => {
    const user = await createWptUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);
    const response = await app.inject({
      method: 'GET',
      url: '/role-wpt',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 401 when no session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/role-wpt',
    });
    expect(response.statusCode).toBe(401);
  });

  it('allows SUPER_ADMIN when SUPER_ADMIN is in the roles list', async () => {
    const user = await createSuperAdminUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);
    const response = await app.inject({
      method: 'GET',
      url: '/role-super-admin',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('allows multiple roles in the list', async () => {
    const user = await createClientUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);
    const response = await app.inject({
      method: 'GET',
      url: '/role-client-or-wpt',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('denies a role not in the multiple list', async () => {
    const user = await createClientUser();
    const { sessionId } = await createSessionForUser(user.id);
    const cookie = makeSignedCookie(sessionId);
    // /role-wpt requires WPT or SUPER_ADMIN — CLIENT should be denied
    const response = await app.inject({
      method: 'GET',
      url: '/role-wpt',
      headers: { Cookie: cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});
