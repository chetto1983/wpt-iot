import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
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
import { wsRoute } from './ws/route.js';

const isDev = process.env.NODE_ENV !== 'production';

export function buildServer(): ReturnType<typeof Fastify> {
  const server = Fastify({
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

  // 1. CORS — must be first
  server.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // 2. Cookie parser
  server.register(fastifyCookie);

  // 3. Session with Drizzle-backed store
  server.register(fastifySession, {
    secret: config.sessionSecret,
    store: new DrizzleSessionStore(),
    cookie: {
      httpOnly: true,
      secure: false, // LAN over HTTP (wpt.local), not HTTPS
      sameSite: 'lax',
      maxAge: 86400000, // 24h per D-02
      path: '/',
    },
    saveUninitialized: false,
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

  // 7. WebSocket route (session-authenticated)
  server.register(wsRoute);

  // 8. Health check
  server.register(healthRoute);

  // 9. Auth routes (login, logout, me, change-password)
  server.register(authRoutes);

  // 10. User CRUD routes (SuperAdmin only)
  server.register(userRoutes);

  // 11. Avatar upload/delete routes (any authenticated user)
  server.register(avatarRoutes);

  // 12. RFID routes (WPT + SUPER_ADMIN)
  server.register(rfidRoutes);

  // 13. Job routes (WPT + SUPER_ADMIN)
  server.register(jobRoutes);

  // 14. Report routes (all authenticated)
  server.register(reportRoutes);

  // 15. Alarm report routes (WPT + SUPER_ADMIN)
  server.register(alarmReportRoutes);

  // 16. Chart data routes (all authenticated)
  server.register(chartRoutes);

  // 17. Dashboard routes (all authenticated)
  server.register(dashboardRoutes);

  return server;
}
