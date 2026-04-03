import { describe, it } from 'vitest';

describe('seedDefaultAdmin', () => {
  it.todo('creates admin user when auth_users table is empty (AUTH-07)');
  it.todo('skips seed when users already exist');
  it.todo('throws error when ADMIN_PASSWORD env var is missing');
  it.todo('hashes password with bcrypt before inserting');
  it.todo('uses onConflictDoNothing for race condition safety');
});
