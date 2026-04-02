import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { healthRoutes } from './routes/healthRoutes.js';
import { stateRoutes } from './routes/stateRoutes.js';
import { scenarioRoutes } from './routes/scenarioRoutes.js';
import { faultRoutes } from './routes/faultRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const server = Fastify({
    logger: {
      level: 'info',
      ...(process.env.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty' },
      }),
    },
  });

  // CORS - allow all origins for dev tool
  await server.register(fastifyCors, { origin: true });

  // Serve static files from public/ directory
  await server.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // Register routes
  await server.register(healthRoutes);
  await server.register(stateRoutes);
  await server.register(scenarioRoutes);
  await server.register(faultRoutes);

  return server;
}
