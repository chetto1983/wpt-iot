import type { FastifyInstance } from 'fastify';
import { getState, updateState } from '../state/simulatorState.js';
import type { DeepPartial, ISimulatorState } from '../state/simulatorState.js';
import { cycleEngine } from '../state/cycleEngine.js';
import { alarmEngine } from '../state/alarmEngine.js';

export async function stateRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/state', async (_request, _reply) => {
    return getState();
  });

  fastify.put<{ Body: DeepPartial<ISimulatorState> }>('/api/state', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: 'Request body must be a non-null object' });
    }
    updateState(body, 'external');
    return getState();
  });

  /** Get auto-cycle and alarm engine status */
  fastify.get('/api/cycle/status', async (_request, _reply) => {
    return {
      cycle: cycleEngine.getStatus(),
      alarms: alarmEngine.getStatus(),
    };
  });

  /** Pause auto-cycle and alarm engines */
  fastify.post('/api/cycle/pause', async (_request, _reply) => {
    cycleEngine.pause();
    alarmEngine.pause();
    return {
      status: 'paused',
      cycle: cycleEngine.getStatus(),
    };
  });

  /** Resume auto-cycle and alarm engines */
  fastify.post('/api/cycle/resume', async (_request, _reply) => {
    cycleEngine.resume();
    alarmEngine.resume();
    return {
      status: 'resumed',
      cycle: cycleEngine.getStatus(),
    };
  });
}
