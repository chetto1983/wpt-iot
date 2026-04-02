import type { FastifyPluginAsync } from 'fastify';

export const healthRoute: FastifyPluginAsync = async (server) => {
  server.get('/health', async (_request, _reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
};
