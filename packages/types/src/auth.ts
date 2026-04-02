import { z } from 'zod/v4';
import { UserRole } from './enums.js';

/** Auth user stored in database */
export interface IAuthUser {
  id: number;
  username: string;
  password: string;
  role: UserRole;
  createdAt: Date;
}

/** Session data for authenticated user */
export interface ISession {
  userId: number;
  username: string;
  role: UserRole;
  language: 'it' | 'en';
}

export const AuthUserSchema = z.object({
  id: z.number(),
  username: z.string().min(1),
  password: z.string().min(1),
  role: z.nativeEnum(UserRole),
  createdAt: z.date(),
});

export const SessionSchema = z.object({
  userId: z.number(),
  username: z.string().min(1),
  role: z.nativeEnum(UserRole),
  language: z.enum(['it', 'en']),
});

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  language: z.enum(['it', 'en']).optional(),
});
