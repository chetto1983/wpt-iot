import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Applies all pending Drizzle migrations from the `drizzle/` folder.
 *
 * Path resolution (ESM-safe):
 *   - Source:  src/db/migrator.ts
 *   - Compiled: dist/db/migrator.js  →  import.meta.url dir = <pkg>/dist/db/
 *   - drizzle folder:  ../../drizzle  →  <pkg>/drizzle/   ✓
 *
 * In Docker the package root is /app/apps/backend/, so:
 *   - dist/db/migrator.js lives at /app/apps/backend/dist/db/migrator.js
 *   - migrationsFolder resolves to /app/apps/backend/drizzle/
 *
 * drizzle-orm's migrate() is idempotent: it tracks applied migrations in the
 * __drizzle_migrations table and skips already-applied files.
 */
export async function applyMigrations(pool: Pool, logger: FastifyBaseLogger): Promise<void> {
  const migrationsFolder = path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../drizzle',
  );

  logger.info({ name: 'Migrations' }, `Running drizzle migrations from ${migrationsFolder}`);
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  logger.info({ name: 'Migrations' }, 'Drizzle migrations complete');
}
