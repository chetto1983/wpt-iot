import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { rfidUsers, rfidUserChanges } from '../db/schema/users.js';
import type { IRfidUser } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Subscribe to user:data events and persist RFID users with diff logging.
 * Per D-05: Mirror + diff log model. Upsert by tagId, log changes.
 * Per D-06: PLC is master. IoT mirrors what PLC reports.
 * Per D-12/Phase 3: DB failures logged, never crash.
 */
export function startUserStore(log: IStoreLogger): void {
  dataHub.onUserData(async (users: IRfidUser[]) => {
    try {
      // 1. Read current state from DB for diff detection
      const current = await db.select().from(rfidUsers);
      const currentMap = new Map(current.map(u => [u.tagId, u]));

      // 2. Process each user: detect diffs, then upsert
      for (const user of users) {
        const prev = currentMap.get(user.tagId);

        // Log diff if fields changed (skip on first read when prev is undefined)
        if (prev && (
          prev.name !== user.name ||
          prev.group !== user.group ||
          prev.enabled !== user.enabled
        )) {
          await db.insert(rfidUserChanges).values({
            tagId: user.tagId,
            previousName: prev.name,
            previousGroup: prev.group,
            previousEnabled: prev.enabled,
            currentName: user.name,
            currentGroup: user.group,
            currentEnabled: user.enabled,
          });
        }

        // 3. Upsert user (Drizzle onConflictDoUpdate on tagId unique constraint)
        await db.insert(rfidUsers).values({
          tagId: user.tagId,
          name: user.name,
          group: user.group,
          enabled: user.enabled,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: rfidUsers.tagId,
          set: {
            name: user.name,
            group: user.group,
            enabled: user.enabled,
            updatedAt: new Date(),
          },
        });
      }

      log.info(
        { name: 'UserStore', userCount: users.length },
        'RFID users persisted',
      );
    } catch (err) {
      log.error(
        { name: 'UserStore', err: (err as Error).message },
        'Failed to persist RFID users',
      );
    }
  });
  log.info({ name: 'UserStore' }, 'RFID user persistence subscriber started');
}
