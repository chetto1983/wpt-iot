/**
 * Phase 32-02: AuthService integration tests.
 *
 * Tests login, CRUD, and password operations against a real PostgreSQL DB.
 * TRUNCATE sessions, auth_users CASCADE in beforeEach for isolation.
 * Uses createTestUser() fixture (bcrypt cost 4) per D-07.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, pool } from '../db/index.js';
import { AuthService } from '../auth/authService.js';
import {
  buildIntegrationServer,
} from './fixtures/setupIntegrationTest.js';
import {
  createTestUser,
  createClientUser,
} from './fixtures/testUsers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await db.execute(sql`TRUNCATE sessions, auth_users CASCADE`);
  app = await buildIntegrationServer();
});

afterAll(async () => {
  await app.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
});

describe('AuthService', () => {
  describe('login', () => {
    it('returns user without password hash on valid credentials', async () => {
      const user = await createTestUser({ role: 'CLIENT' as never });
      const result = await AuthService.login(user.username, 'test-password');
      expect(result).not.toBeNull();
      expect(result!.id).toBe(user.id);
      expect(result!.username).toBe(user.username);
      expect((result as Record<string, unknown>)['password']).toBeUndefined();
    });

    it('returns null for unknown username', async () => {
      const result = await AuthService.login('nonexistent_user_xyz', 'x');
      expect(result).toBeNull();
    });

    it('returns null for wrong password', async () => {
      const user = await createClientUser();
      const result = await AuthService.login(user.username, 'wrong-password');
      expect(result).toBeNull();
    });
  });

  describe('getById', () => {
    it('returns user data for existing id', async () => {
      const user = await createTestUser({ role: 'WPT' as never });
      const result = await AuthService.getById(user.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(user.id);
      expect(result!.username).toBe(user.username);
      expect(result!.role).toBe(user.role);
    });

    it('returns null for non-existent id', async () => {
      const result = await AuthService.getById(999999);
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a new user with hashed password', async () => {
      const result = await AuthService.create('new_user_test', 'secret123', 'CLIENT');
      expect(result).not.toBeNull();
      expect(result.id).toBeTypeOf('number');
      expect(result.username).toBe('new_user_test');
      expect(result.role).toBe('CLIENT');
      expect((result as Record<string, unknown>)['password']).toBeUndefined();
    });

    it('throws on duplicate username', async () => {
      await AuthService.create('dup_user_test', 'pass1', 'CLIENT');
      await expect(
        AuthService.create('dup_user_test', 'pass2', 'WPT'),
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('updates username', async () => {
      const user = await createClientUser();
      const result = await AuthService.update(user.id, { username: 'updated_name_test' });
      expect(result).not.toBeNull();
      expect(result!.username).toBe('updated_name_test');
    });

    it('does not change role when not in update payload', async () => {
      const user = await createClientUser();
      const result = await AuthService.update(user.id, { username: 'another_name_test' });
      expect(result).not.toBeNull();
      expect(result!.role).toBe(user.role);
    });
  });

  describe('updatePassword (verifyPassword + changePassword)', () => {
    it('changes password when current password is correct', async () => {
      const user = await createClientUser();
      // Verify current password first
      const valid = await AuthService.verifyPassword(user.id, 'test-password');
      expect(valid).toBe(true);
      // Change password
      const changed = await AuthService.changePassword(user.id, 'new-password-123');
      expect(changed).toBe(true);
      // New password works for login
      const loginResult = await AuthService.login(user.username, 'new-password-123');
      expect(loginResult).not.toBeNull();
    });

    it('rejects when current password is wrong', async () => {
      const user = await createClientUser();
      const valid = await AuthService.verifyPassword(user.id, 'wrong-current-password');
      expect(valid).toBe(false);
    });
  });

  describe('changePassword', () => {
    it('changes password without checking current password', async () => {
      const user = await createClientUser();
      const changed = await AuthService.changePassword(user.id, 'brand-new-password');
      expect(changed).toBe(true);
      // Login with brand new password succeeds
      const loginResult = await AuthService.login(user.username, 'brand-new-password');
      expect(loginResult).not.toBeNull();
      expect(loginResult!.id).toBe(user.id);
    });
  });

  describe('deleteUser', () => {
    it('removes user from database', async () => {
      const user = await createClientUser();
      const deleted = await AuthService.deleteUser(user.id);
      expect(deleted).toBe(true);
      const found = await AuthService.getById(user.id);
      expect(found).toBeNull();
    });

    it('deleting non-existent id does not throw', async () => {
      await expect(AuthService.deleteUser(999999)).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    it('returns all users without password field', async () => {
      await createClientUser();
      await createClientUser();
      const users = await AuthService.list();
      expect(users.length).toBeGreaterThanOrEqual(2);
      for (const u of users) {
        expect((u as Record<string, unknown>)['password']).toBeUndefined();
        expect(u.id).toBeTypeOf('number');
        expect(u.username).toBeTypeOf('string');
      }
    });

    it('returns empty array when no users exist', async () => {
      const users = await AuthService.list();
      expect(users).toEqual([]);
    });
  });

  describe('verifyPassword', () => {
    it('returns true when current password matches the stored hash', async () => {
      const user = await createClientUser();
      const valid = await AuthService.verifyPassword(user.id, 'test-password');
      expect(valid).toBe(true);
    });

    it('returns false when user does not exist', async () => {
      const valid = await AuthService.verifyPassword(999999, 'anything');
      expect(valid).toBe(false);
    });
  });
});
