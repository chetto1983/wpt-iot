import { z } from 'zod/v4';
import { RfidUserGroup } from './enums.js';

/** Single RFID tag user (PLC-side, port 9092) */
export interface IRfidUser {
  tagId: number;              // 1-48
  name: string;               // STRING[20] from S3_S_DATO_1..48
  group: RfidUserGroup;       // BYTE from S3_B_DATO_1..48 (0=operator, 1=maintenance, 2=admin)
  enabled: boolean;           // BYTE from S3_B_DATO_49..96 (0=enabled, 1=disabled — inverted logic)
}

export const RfidUserSchema = z.object({
  tagId: z.int().min(1).max(48),
  name: z.string().max(20),
  group: z.nativeEnum(RfidUserGroup),
  enabled: z.boolean(),
});

/**
 * Wire-layer payload for /api/rfid/write.
 *
 * Enforces exactly 48 users AND the invariant that every enabled user has a
 * non-empty name. An enabled slot with a blank name would leave the PLC with
 * an enabled access tag nobody can identify, so the empty-name case is only
 * legitimate for DISABLED slots (i.e., unused tags on a fresh PLC).
 */
export const RfidUsersPayloadSchema = z.object({
  users: z
    .array(RfidUserSchema)
    .length(48)
    .refine(
      (users) => users.every((u) => !u.enabled || u.name.trim().length > 0),
      { message: 'Enabled users must have a non-empty name' },
    ),
});

export type RfidUsersPayload = z.infer<typeof RfidUsersPayloadSchema>;
