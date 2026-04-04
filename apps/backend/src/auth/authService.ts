import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { IAuthUser } from '@wpt/types';
import { db } from '../db/index.js';
import { authUsers, sessions } from '../db/schema/auth.js';

const SALT_ROUNDS = 12;

/**
 * Static auth service with login, CRUD, and password operations.
 * All methods exclude the password hash from return values.
 */
export class AuthService {
  /**
   * Validate credentials and return user without password hash.
   * Returns null on invalid username or password mismatch.
   */
  static async login(
    username: string,
    password: string,
  ): Promise<Omit<IAuthUser, 'password'> | null> {
    const rows = await db
      .select()
      .from(authUsers)
      .where(eq(authUsers.username, username));
    const user = rows[0];
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return null;

    // Explicitly exclude password from return value
    return {
      id: user.id,
      username: user.username,
      role: user.role as IAuthUser['role'],
      avatar: user.avatar ?? null,
      createdAt: user.createdAt,
    };
  }

  /**
   * Get user by ID (without password).
   */
  static async getById(
    id: number,
  ): Promise<{ id: number; username: string; role: string; avatar: string | null } | null> {
    const rows = await db
      .select({
        id: authUsers.id,
        username: authUsers.username,
        role: authUsers.role,
        avatar: authUsers.avatar,
      })
      .from(authUsers)
      .where(eq(authUsers.id, id));
    const row = rows[0];
    if (!row) return null;
    return { ...row, avatar: row.avatar ?? null };
  }

  /**
   * List all users (without passwords).
   */
  static async list(): Promise<
    Array<{ id: number; username: string; role: string; avatar: string | null; createdAt: Date }>
  > {
    const rows = await db
      .select({
        id: authUsers.id,
        username: authUsers.username,
        role: authUsers.role,
        avatar: authUsers.avatar,
        createdAt: authUsers.createdAt,
      })
      .from(authUsers);
    return rows.map((r) => ({ ...r, avatar: r.avatar ?? null }));
  }

  /**
   * Create a new user with hashed password. Returns the created user (without password).
   */
  static async create(
    username: string,
    password: string,
    role: string,
  ): Promise<{ id: number; username: string; role: string; avatar: string | null; createdAt: Date }> {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const rows = await db
      .insert(authUsers)
      .values({ username, password: hash, role })
      .returning({
        id: authUsers.id,
        username: authUsers.username,
        role: authUsers.role,
        avatar: authUsers.avatar,
        createdAt: authUsers.createdAt,
      });
    const row = rows[0]!;
    return { ...row, avatar: row.avatar ?? null };
  }

  /**
   * Update user fields (username, role). Returns updated user or null if not found.
   */
  static async update(
    id: number,
    data: { username?: string; role?: string },
  ): Promise<{ id: number; username: string; role: string; avatar: string | null; createdAt: Date } | null> {
    const rows = await db
      .update(authUsers)
      .set(data)
      .where(eq(authUsers.id, id))
      .returning({
        id: authUsers.id,
        username: authUsers.username,
        role: authUsers.role,
        avatar: authUsers.avatar,
        createdAt: authUsers.createdAt,
      });
    const row = rows[0];
    if (!row) return null;
    return { ...row, avatar: row.avatar ?? null };
  }

  /**
   * Set or clear a user's avatar URL. Returns updated user or null if not found.
   */
  static async updateAvatar(
    id: number,
    avatarUrl: string | null,
  ): Promise<{ id: number; username: string; role: string; avatar: string | null; createdAt: Date } | null> {
    const rows = await db
      .update(authUsers)
      .set({ avatar: avatarUrl })
      .where(eq(authUsers.id, id))
      .returning({
        id: authUsers.id,
        username: authUsers.username,
        role: authUsers.role,
        avatar: authUsers.avatar,
        createdAt: authUsers.createdAt,
      });
    const row = rows[0];
    if (!row) return null;
    return { ...row, avatar: row.avatar ?? null };
  }

  /**
   * Hash and update a user's password. Returns true if user existed.
   */
  static async changePassword(id: number, newPassword: string): Promise<boolean> {
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const rows = await db
      .update(authUsers)
      .set({ password: hash })
      .where(eq(authUsers.id, id))
      .returning({ id: authUsers.id });
    return rows.length > 0;
  }

  /**
   * Verify a user's current password against stored hash.
   */
  static async verifyPassword(id: number, currentPassword: string): Promise<boolean> {
    const rows = await db
      .select({ password: authUsers.password })
      .from(authUsers)
      .where(eq(authUsers.id, id));
    const user = rows[0];
    if (!user) return false;
    return bcrypt.compare(currentPassword, user.password);
  }

  /**
   * Delete a user and their associated sessions. Returns true if user existed.
   */
  static async deleteUser(id: number): Promise<boolean> {
    // Delete associated sessions first (FK constraint)
    await db.delete(sessions).where(eq(sessions.userId, id));
    const rows = await db
      .delete(authUsers)
      .where(eq(authUsers.id, id))
      .returning({ id: authUsers.id });
    return rows.length > 0;
  }
}
