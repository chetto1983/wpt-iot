import type { FastifyInstance } from 'fastify';
import { SCENARIOS, applyScenario } from '../state/scenarios.js';
import { getState } from '../state/simulatorState.js';
import { cycleEngine } from '../state/cycleEngine.js';
import { alarmEngine } from '../state/alarmEngine.js';

export async function scenarioRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: { name: string } }>('/api/scenario', async (request, reply) => {
    const { name } = request.body;

    // Special 'auto-cycle' scenario: reset and resume engines
    if (name === 'auto-cycle') {
      cycleEngine.reset();
      alarmEngine.reset();
      return {
        scenario: 'auto-cycle',
        cycle: cycleEngine.getStatus(),
        state: getState(),
      };
    }

    const validNames = [...Object.keys(SCENARIOS), 'auto-cycle'];

    if (!name || !validNames.includes(name)) {
      return reply.status(400).send({
        error: `Unknown scenario. Valid: ${validNames.join(', ')}`,
      });
    }

    applyScenario(name);
    // Pause auto-cycle when user applies a manual scenario
    cycleEngine.pause();
    alarmEngine.pause();
    return getState();
  });
}
