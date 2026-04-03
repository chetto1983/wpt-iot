import { describe, it } from 'vitest';

describe('AuthService', () => {
  describe('login', () => {
    it.todo('returns user without password field for valid credentials (AUTH-01)');
    it.todo('returns null for invalid username');
    it.todo('returns null for invalid password');
    it.todo('response body does NOT contain password field');
  });

  describe('create', () => {
    it.todo('creates a new user with hashed password (AUTH-03)');
    it.todo('rejects duplicate username');
  });

  describe('update', () => {
    it.todo('updates username and role (AUTH-04)');
    it.todo('returns null for non-existent user');
  });

  describe('changePassword', () => {
    it.todo('hashes and updates password (AUTH-03)');
    it.todo('returns false for non-existent user');
  });

  describe('deleteUser', () => {
    it.todo('deletes user and associated sessions (AUTH-03)');
    it.todo('returns false for non-existent user');
  });

  describe('language at login', () => {
    it.todo('login route stores language in session (AUTH-06)');
    it.todo('defaults to Italian when language not provided');
  });
});

describe('POST /auth/change-password (self)', () => {
  it.todo('authenticated user can change own password with correct current password (D-15)');
  it.todo('rejects when current password is wrong');
  it.todo('rejects when not authenticated');
});
