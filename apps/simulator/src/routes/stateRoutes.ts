import type { FastifyInstance } from 'fastify';
import { getState, updateState } from '../state/simulatorState.js';
import type { DeepPartial, ISimulatorState } from '../state/simulatorState.js';

export async function stateRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/state', async (_request, _reply) => {
    return getState();
  });

  fastify.put<{ Body: DeepPartial<ISimulatorState> }>('/api/state', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: 'Request body must be a non-null object' });
    }
    updateState(body);
    return getState();
  });
}
