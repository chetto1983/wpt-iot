import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { DrizzleSessionStore } from './auth/sessionStore.js';
import { healthRoute } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { avatarRoutes } from './routes/avatar.js';
import { rfidRoutes } from './routes/rfid.js';
import { jobRoutes } from './routes/jobs.js';
import { reportRoutes } from './routes/reports.js';
import { alarmReportRoutes } from './routes/alarmReports.js';
import { chartRoutes } from './routes/charts.js';
import { dashboardRoutes } from './routes/dashboards.js';
import { mqttRoutes } from './routes/mqtt.js';
import { plcConfigRoutes } from './routes/plcConfig.js';
import { energyRoutes } from './routes/energy.js';
import { cycleRoutes } from './routes/cycles.js';
import { alarmCatalogRoutes } from './routes/alarmCatalog.js';
import { wsRoute } from './ws/route.js';

const isDev = process.env.NODE_ENV !== 'production';

export function buildServer(): FastifyInstance {
  const server: FastifyInstance = Fastify({
    trustProxy: config.trustProxy,
    logger: isDev
      ? {
          level: 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        }
      : { level: 'info' },
  });

  // 1. CORS — deliberately disabled. No Access-Control-Allow-* headers are
  // emitted. Browser traffic reaches /api only via the same origin as the
  // frontend (nginx in prod, Next.js rewrite in dev), so the Same-Origin
  // Policy enforces isolation without an allowlist to maintain. OWASP:
  // "if you don't use the Access-Control-Allow-Origin header, your site is
  // protected by default by the Same Origin Policy."
  server.register(cors, {
    origin: false,
    credentials: false,
  });

  // 1b. Same-origin defense in depth. If an Origin header is present, it must
  // match the request's Host (respecting X-Forwarded-Host when trustProxy is
  // on). Blocks CSRF-style cross-site form submissions that slip past
  // SameSite=Strict due to browser RFC bypasses.
  server.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return; // Same-origin navigations + server-to-server calls omit Origin — allow.
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return reply.code(400).send({ error: 'Malformed Origin header' });
    }
    if (originHost !== request.hostname) {
      request.log.warn(
        { origin, host: request.hostname, ip: request.ip, url: request.url },
        'Origin/Host mismatch — rejected',
      );
      return reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
  });

  // 2. Cookie parser
  server.register(fastifyCookie);

  // 3. Session with Drizzle-backed store
  server.register(fastifySession, {
    secret: config.sessionSecret,
    store: new DrizzleSessionStore(),
    cookie: {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: 'strict',
      maxAge: 86400000, // 24h per D-02
      path: '/',
    },
    saveUninitialized: false,
  });

  // 3b. Structured audit log — one line per request with IP, method, URL,
  // status, userId, User-Agent. Emitted via the existing Pino logger so it
  // flows to stdout -> Docker -> host syslog/journald. Required for CRA
  // "secure logging" and NIS 2 Art. 21 traceability.
  server.addHook('onResponse', async (request, reply) => {
    const session = (request as { session?: { userId?: string | number | null } }).session;
    request.log.info(
      {
        audit: true,
        ip: request.ip,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        userId: session?.userId ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        durationMs: reply.elapsedTime,
      },
      'request',
    );
  });

  // 4. Multipart file upload
  server.register(fastifyMultipart, {
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  });

  // 5. Static file serving for uploads
  const uploadsDir = path.join(process.cwd(), 'uploads', 'avatars');
  fs.mkdirSync(uploadsDir, { recursive: true });
  server.register(fastifyStatic, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
  });

  // 6. WebSocket plugin
  server.register(websocket, {
    options: {
      maxPayload: 65536, // 64KB -- generous for JSON machine data (~4KB)
    },
  });

  // All HTTP + WebSocket routes are mounted under the `/api` prefix so that
  // nginx can proxy a single `location /api/ { proxy_pass http://backend; }`
  // without URI rewriting. The individual route files use their own internal
  // paths (e.g. `/auth/login`, `/energy/aggregate`) and Fastify prepends the
  // prefix at register time.
  const apiOpts = { prefix: '/api' };

  // 7. WebSocket route (session-authenticated) -> /api/ws
  server.register(wsRoute, apiOpts);

  // 8. Health check -> /api/health
  server.register(healthRoute, apiOpts);

  // 9. Auth routes (login, logout, me, change-password) -> /api/auth/*
  server.register(authRoutes, apiOpts);

  // 10. User CRUD routes (SuperAdmin only) -> /api/users
  server.register(userRoutes, apiOpts);

  // 11. Avatar upload/delete routes (any authenticated user)
  server.register(avatarRoutes, apiOpts);

  // 12. RFID routes (WPT + SUPER_ADMIN)
  server.register(rfidRoutes, apiOpts);

  // 13. Job routes (WPT + SUPER_ADMIN)
  server.register(jobRoutes, apiOpts);

  // 14. Report routes (all authenticated)
  server.register(reportRoutes, apiOpts);

  // 15. Alarm report routes (WPT + SUPER_ADMIN)
  server.register(alarmReportRoutes, apiOpts);

  // 16. Chart data routes (all authenticated)
  server.register(chartRoutes, apiOpts);

  // 17. Dashboard routes (all authenticated)
  server.register(dashboardRoutes, apiOpts);

  // 18. MQTT admin routes (Super Admin only).
  // Note: the broker connection itself is initialized after server.listen()
  // by `connectMqtt()` in index.ts, which reads its config from the DB.
  server.register(mqttRoutes, apiOpts);

  // 19. PLC config routes (Super Admin only) — DB-backed PLC target host
  // replaces the legacy SIM_HOST env var. Handshake FSM reads via cache.
  server.register(plcConfigRoutes, apiOpts);

  // 20. Energy routes (Phase 19 Plan 19-10) — read-side aggregate API
  // over the energy_5min/1h/1d/1mo CAGG hierarchy.
  server.register(energyRoutes, apiOpts);

  // 21. Cycle register routes (Phase 24 Plan 24-03a) — /api/cycles page API
  server.register(cycleRoutes, apiOpts);

  // 22. Alarm catalog route — /api/alarms/catalog?lang=en|it
  server.register(alarmCatalogRoutes, apiOpts);

  return server;
}
