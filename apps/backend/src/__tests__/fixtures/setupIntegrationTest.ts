/**
 * Shared Fastify + DB harness for Phase 32 integration tests.
 *
 * Registers @fastify/cookie, @fastify/session (DrizzleSessionStore),
 * and @fastify/websocket so that WS upgrade tests and session-based auth
 * tests both work against a real plugin stack.
 *
 * Re-exports `pool` so test files can call `pool.end()` in afterAll.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import websocket from '@fastify/websocket';
import { DrizzleSessionStore } from '../../auth/sessionStore.js';

export { pool } from '../../db/index.js';

export async function buildIntegrationServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: 'test-secret-32-chars-minimum-here!',
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
  await app.register(websocket);

  await app.ready();
  return app;
}
