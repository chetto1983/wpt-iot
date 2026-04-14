/**
 * Test user creation helpers for Phase 32 integration tests.
 *
 * Usernames follow the pattern `test_<8-char-uuid-fragment>` per D-13
 * to avoid namespace collisions with dev DB data across parallel runs.
 * Passwords are hashed at bcrypt cost 4 (not 12) for test speed per D-07.
 */
import bcrypt from 'bcryptjs';
import { UserRole } from '@wpt/types';
import { db } from '../../db/index.js';
import { authUsers } from '../../db/schema/auth.js';

export interface ITestUser {
  id: number;
  username: string;
  role: string;
}

export async function createTestUser(opts: { role: UserRole }): Promise<ITestUser> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `test_${suffix}`;
  const hash = await bcrypt.hash('test-password', 4);
  const rows = await db
    .insert(authUsers)
    .values({ username, password: hash, role: opts.role })
    .returning({
      id: authUsers.id,
      username: authUsers.username,
      role: authUsers.role,
    });
  const row = rows[0];
  if (!row) throw new Error('createTestUser: insert returned empty result');
  return row;
}

export const createClientUser = (): Promise<ITestUser> =>
  createTestUser({ role: UserRole.CLIENT });

export const createWptUser = (): Promise<ITestUser> =>
  createTestUser({ role: UserRole.WPT });

export const createSuperAdminUser = (): Promise<ITestUser> =>
  createTestUser({ role: UserRole.SUPER_ADMIN });
