import Fastify from 'fastify';
import { healthRoute } from './routes/health.js';

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

  server.register(healthRoute);

  return server;
}
