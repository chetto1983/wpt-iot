import { z } from 'zod/v4';

/** 40 alarm words from Mappatura AC500->IOT_9091 (S2_I_DATO_1..40), each 16-bit INT */
export interface IAlarmWords {
  words: number[];  // 40 elements, each a 16-bit INT (16 bits = 16 alarm flags per word)
}

export const AlarmWordsSchema = z.object({
  words: z.array(z.int()).length(40),
});

/** Individual alarm event record */
export interface IAlarmEvent {
  id: number;
  alarmIndex: number;       // Global alarm index (0-639)
  wordIndex: number;        // Which of the 40 alarm words (0-39)
  bitIndex: number;         // Which bit within the word (0-15)
  active: boolean;          // true=activation, false=reset
  activatedAt: Date;
  resetAt: Date | null;
  descriptionIt: string;    // Italian alarm description
  descriptionEn: string;    // English alarm description
}

export const AlarmEventSchema = z.object({
  id: z.number(),
  alarmIndex: z.int().min(0).max(639),
  wordIndex: z.int().min(0).max(39),
  bitIndex: z.int().min(0).max(15),
  active: z.boolean(),
  activatedAt: z.date(),
  resetAt: z.date().nullable(),
  descriptionIt: z.string(),
  descriptionEn: z.string(),
});
