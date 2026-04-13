import { z } from 'zod/v4';
import { UserRole } from './enums.js';

/** Auth user stored in database */
export interface IAuthUser {
  id: number;
  username: string;
  password: string;
  role: UserRole;
  avatar?: string | null;
  createdAt: Date;
}

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  language: z.enum(['it', 'en']).optional(),
});
