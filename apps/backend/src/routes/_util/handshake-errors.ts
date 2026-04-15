import type { FastifyReply } from 'fastify';
import { PlcConfigUnavailableError } from '../../udp/plcConfigService.js';

/**
 * Map FSM and config errors to the correct HTTP response.
 *
 * Used by rfid.ts and jobs.ts route catch blocks so the mapping logic
 * is not duplicated across every FSM-invoking endpoint.
 *
 * Error mapping:
 *  - PlcConfigUnavailableError     → 503 Service Unavailable
 *  - 'Handshake in progress' msg   → 409 Conflict
 *  - 'Handshake timeout' msg       → 504 Gateway Timeout
 *  - Anything else                 → 500 Internal Server Error (+ log.error)
 */
export function mapHandshakeError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof PlcConfigUnavailableError) {
    return reply.code(503).send({ error: err.message });
  }
  const msg = err instanceof Error ? err.message : 'Unknown error';
  if (msg.includes('Handshake in progress')) return reply.code(409).send({ error: msg });
  if (msg.includes('Handshake timeout'))     return reply.code(504).send({ error: msg });
  reply.log.error({ err }, 'Handshake error');
  return reply.code(500).send({ error: msg });
}
