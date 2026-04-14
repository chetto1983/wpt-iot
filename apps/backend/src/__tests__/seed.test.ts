/**
 * Phase 32-02: seedDefaultAdmin integration tests.
 *
 * config.adminPassword is a module-level constant (process.env.ADMIN_PASSWORD ?? '').
 * To override it per test, each test dynamically imports seedDefaultAdmin after
 * setting process.env.ADMIN_PASSWORD and calls vi.resetModules() to clear the
 * module cache. This ensures config is re-evaluated with the new env value.
 *
 * TRUNCATE auth_users, sessions CASCADE in beforeEach for isolation.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, pool } from '../db/index.js';
import { authUsers } from '../db/schema/auth.js';
import { AuthService } from '../auth/authService.js';

const mockLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as FastifyBaseLogger;

beforeEach(async () => {
  await db.execute(sql`TRUNCATE sessions, auth_users CASCADE`);
  process.env['ADMIN_PASSWORD'] = 'test-admin-pass';
  vi.resetModules();
});

afterEach(() => {
  delete process.env['ADMIN_PASSWORD'];
});

afterAll(async () => {
  await pool.end().catch(() => undefined);
});

describe('seedDefaultAdmin', () => {
  it('creates admin user when auth_users is empty', async () => {
    const { seedDefaultAdmin } = await import('../auth/seed.js');
    await seedDefaultAdmin(mockLogger);

    const rows = await db
      .select({ username: authUsers.username, role: authUsers.role })
      .from(authUsers);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.username).toBe('admin');
    expect(rows[0]!.role).toBe('SUPER_ADMIN');
  });

  it('skips seed when auth_users already has rows', async () => {
    // Pre-insert one user
    await db.execute(
      sql`INSERT INTO auth_users (username, password, role) VALUES ('existing_user', 'hash', 'CLIENT')`,
    );

    const { seedDefaultAdmin } = await import('../auth/seed.js');
    await seedDefaultAdmin(mockLogger);

    const rows = await db.select().from(authUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.username).toBe('existing_user');
  });

  it('uses ADMIN_PASSWORD env var for the password hash', async () => {
    const { seedDefaultAdmin } = await import('../auth/seed.js');
    await seedDefaultAdmin(mockLogger);

    // Login with the seeded password must succeed
    const result = await AuthService.login('admin', 'test-admin-pass');
    expect(result).not.toBeNull();
    expect(result!.username).toBe('admin');
  });

  it('throws when ADMIN_PASSWORD is not set and table is empty', async () => {
    // Set to empty string rather than delete — dotenvx re-injects deleted vars
    // from .env on module re-import; an empty string stays empty.
    process.env['ADMIN_PASSWORD'] = '';
    vi.resetModules();

    const { seedDefaultAdmin } = await import('../auth/seed.js');
    await expect(seedDefaultAdmin(mockLogger)).rejects.toThrow('ADMIN_PASSWORD');
  });

  it('is idempotent — second call is a no-op', async () => {
    const { seedDefaultAdmin } = await import('../auth/seed.js');
    await seedDefaultAdmin(mockLogger);
    await seedDefaultAdmin(mockLogger);

    const rows = await db.select().from(authUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.username).toBe('admin');
  });
});
