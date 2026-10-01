import type { FastifyInstance } from 'fastify';
import { updateState, getState } from '../state/simulatorState.js';

interface IFaultBody {
  faultDropAck?: boolean;
  faultWrongState?: boolean;
  ackDelayMs?: number;
}

export async function faultRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: IFaultBody }>('/api/fault', async (request, _reply) => {
    const body = request.body;
    updateState({ handshake: body });
    return getState().handshake;
  });
}
