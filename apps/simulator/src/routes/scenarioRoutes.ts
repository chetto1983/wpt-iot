import type { FastifyInstance } from 'fastify';
import { SCENARIOS, applyScenario } from '../state/scenarios.js';
import { getState } from '../state/simulatorState.js';

export async function scenarioRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: { name: string } }>('/api/scenario', async (request, reply) => {
    const { name } = request.body;
    const validNames = Object.keys(SCENARIOS);

    if (!name || !validNames.includes(name)) {
      return reply.status(400).send({
        error: `Unknown scenario. Valid: ${validNames.join(', ')}`,
      });
    }

    applyScenario(name);
    return getState();
  });
}
