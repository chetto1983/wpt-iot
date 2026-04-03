import { describe, it } from 'vitest';

describe('requireAuth', () => {
  it.todo('returns 401 when no session exists (AUTH-05)');
  it.todo('returns 401 when session user not found in DB');
  it.todo('passes when valid session with existing user');
  it.todo('re-reads role from database on every request (D-03)');
  it.todo('session cookie has httpOnly and 24h maxAge (AUTH-05)');
});

describe('requireRole', () => {
  it.todo('returns 403 when user role not in allowed roles (AUTH-02)');
  it.todo('passes when user role is in allowed roles');
  it.todo('SUPER_ADMIN can access SuperAdmin-only routes (AUTH-02)');
  it.todo('CLIENT cannot access WPT-only routes (AUTH-02)');
  it.todo('WPT cannot access SuperAdmin-only routes (AUTH-02)');
});
