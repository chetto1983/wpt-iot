/**
 * Direct-DB session insertion helpers for Phase 32 integration tests.
 *
 * Bypasses @fastify/session signing intentionally (D-09): tests inject a raw
 * session row and pass the sessionId cookie directly in request headers.
 * This is safe because these helpers run exclusively against the local Docker
 * dev database — no production equivalent exists.
 */
import { db } from '../../db/index.js';
import { sessions } from '../../db/schema/auth.js';

export interface ITestSession {
  sessionId: string;
  cookie: string;
}

export async function createSessionForUser(
  userId: number,
  opts?: { expiresAt?: Date },
): Promise<ITestSession> {
  const sessionId = crypto.randomUUID();
  const expiresAt = opts?.expiresAt ?? new Date(Date.now() + 86_400_000);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    data: JSON.stringify({ userId }),
    expiresAt,
  });

  return { sessionId, cookie: `sessionId=${sessionId}` };
}
