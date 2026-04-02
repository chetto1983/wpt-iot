import Fastify from 'fastify';
import { healthRoute } from './routes/health.js';

export function buildServer(): ReturnType<typeof Fastify> {
  const server = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  server.register(healthRoute);

  return server;
}
