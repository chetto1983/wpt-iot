import type { Session } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions } from '../db/schema/auth.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Callback = (err?: any) => void;
type CallbackSession = (err: any, result?: Session | null) => void;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Drizzle-backed session store for @fastify/session.
 * Implements set/get/destroy with PostgreSQL persistence.
 */
export class DrizzleSessionStore {
  set(sessionId: string, session: Session, callback: Callback): void {
    const userId = (session as unknown as Record<string, unknown>).userId as number ?? 0;
    const data = JSON.stringify(session);
    const expiresAt = session.cookie.expires
      ? new Date(session.cookie.expires)
      : new Date(Date.now() + 86_400_000); // 24h default per D-02

    db.insert(sessions)
      .values({ id: sessionId, userId, data, expiresAt })
      .onConflictDoUpdate({
        target: sessions.id,
        set: { userId, data, expiresAt },
      })
      .then(() => callback())
      .catch((err: unknown) => callback(err));
  }

  get(sessionId: string, callback: CallbackSession): void {
    db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .then((rows) => {
        const row = rows[0];
        if (!row) {
          return callback(null, null);
        }
        if (row.expiresAt < new Date()) {
          // Session expired — clean up and return null
          db.delete(sessions)
            .where(eq(sessions.id, sessionId))
            .then(() => callback(null, null))
            .catch((err: unknown) => callback(err));
          return;
        }
        const data: unknown = row.data ? JSON.parse(row.data) : null;
        callback(null, data as Session | null);
      })
      .catch((err: unknown) => callback(err));
  }

  destroy(sessionId: string, callback: Callback): void {
    db.delete(sessions)
      .where(eq(sessions.id, sessionId))
      .then(() => callback())
      .catch((err: unknown) => callback(err));
  }
}
