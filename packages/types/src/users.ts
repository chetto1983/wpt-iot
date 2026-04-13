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
