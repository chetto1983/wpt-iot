import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { DrizzleSessionStore } from './auth/sessionStore.js';
import { healthRoute } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
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

  // 4. WebSocket plugin
  server.register(websocket, {
    options: {
      maxPayload: 65536, // 64KB -- generous for JSON machine data (~4KB)
    },
  });

  // 5. WebSocket route (session-authenticated)
  server.register(wsRoute);

  // 6. Health check
  server.register(healthRoute);

  // 7. Auth routes (login, logout, me, change-password)
  server.register(authRoutes);

  // 8. User CRUD routes (SuperAdmin only)
  server.register(userRoutes);

  return server;
}
