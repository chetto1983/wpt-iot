import bcrypt from 'bcryptjs';
import { count } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/index.js';
import { authUsers } from '../db/schema/auth.js';
import { config } from '../config.js';

const SALT_ROUNDS = 12;

/**
 * Seed the default SuperAdmin account when the auth_users table is empty.
 * Requires ADMIN_PASSWORD env var to be set for the initial seed.
 * Uses onConflictDoNothing for defensive handling (per Research Pitfall 7).
 */
export async function seedDefaultAdmin(logger: FastifyBaseLogger): Promise<void> {
  const [result] = await db.select({ total: count() }).from(authUsers);
  if (result && result.total > 0) {
    logger.info({ name: 'Seed' }, 'Auth users exist, skipping seed');
    return;
  }

  if (!config.adminPassword) {
    throw new Error(
      'ADMIN_PASSWORD environment variable is required for initial seed. Set it in your .env file.',
    );
  }

  const hash = await bcrypt.hash(config.adminPassword, SALT_ROUNDS);
  await db
    .insert(authUsers)
    .values({ username: 'admin', password: hash, role: 'SUPER_ADMIN' })
    .onConflictDoNothing();

  logger.info({ name: 'Seed' }, 'Default SuperAdmin account created');
}
