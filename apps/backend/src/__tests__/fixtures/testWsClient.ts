/**
 * Authenticated WebSocket test client for Phase 32 integration tests.
 *
 * connectAuthedWs() opens a real ws.WebSocket upgrade against a running
 * Fastify server with a Cookie header. The server must have @fastify/websocket
 * registered (provided by buildIntegrationServer) and the wsRoute mounted
 * under the '/api' prefix — the live wire path is '/api/ws'.
 *
 * Usage:
 *   const app = await buildIntegrationServer();
 *   app.register(wsRoute, { prefix: '/api' });
 *   await app.ready();
 *   const { cookie } = await createSessionForUser(userId);
 *   const ws = await connectAuthedWs(app, cookie);
 *   const msg = await receiveNextMessage(ws);
 *   ws.close();
 *   await app.close();
 *
 * NOTE: wsRoute defines the handler path as '/ws'. server.ts registers it
 * with `apiOpts = { prefix: '/api' }` (server.ts line 148), so the live
 * wire path is '/api/ws'. Test files that register wsRoute directly on the
 * bare buildIntegrationServer app must use `app.register(wsRoute, { prefix: '/api' })`
 * so the path matches.
 */
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';

export async function connectAuthedWs(
  app: FastifyInstance,
  cookie: string,
): Promise<WebSocket> {
  // port: 0 picks an ephemeral port; app.listen returns the base URL string
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  // Route is registered under '/api' prefix — wire path is '/api/ws'
  const url = address.replace('http', 'ws') + '/api/ws';
  const ws = new WebSocket(url, { headers: { Cookie: cookie } });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

export function receiveNextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
    ws.once('error', reject);
  });
}
