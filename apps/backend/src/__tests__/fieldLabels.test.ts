import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getFieldLabel, getAlarmFieldLabels } from '@wpt/types';
import { WPT_VISIBLE_FIELDS } from '@wpt/types';
import { buildIntegrationServer, pool } from './fixtures/setupIntegrationTest.js';

describe('fieldLabels (I18N-04)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // No TRUNCATE needed — pure-logic tests, no DB writes
    app = await buildIntegrationServer();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  describe('getFieldLabel', () => {
    it('returns Italian label for garbageTemp when locale is it', () => {
      expect(getFieldLabel('garbageTemp', 'it')).toBe('Temperatura rifiuti');
    });

    it('returns English label for garbageTemp when locale is en', () => {
      expect(getFieldLabel('garbageTemp', 'en')).toBe('Garbage Temperature');
    });

    it('returns the raw field name when no translation exists', () => {
      expect(getFieldLabel('nonExistentField99999', 'it')).toBe('nonExistentField99999');
    });

    it('has translations for all 42 WPT_VISIBLE_FIELDS plus timestamp', () => {
      for (const field of WPT_VISIBLE_FIELDS) {
        expect(
          getFieldLabel(field, 'it'),
          `Missing Italian translation for field: ${field}`,
        ).not.toBe(field);
        expect(
          getFieldLabel(field, 'en'),
          `Missing English translation for field: ${field}`,
        ).not.toBe(field);
      }
      // timestamp is always included in exports even though not in WPT_VISIBLE_FIELDS
      expect(getFieldLabel('timestamp', 'it')).not.toBe('timestamp');
      expect(getFieldLabel('timestamp', 'en')).not.toBe('timestamp');
    });

    it('Italian and English maps have identical key sets', () => {
      const itHasTranslation = WPT_VISIBLE_FIELDS.every(
        (f) => getFieldLabel(f, 'it') !== f,
      );
      const enHasTranslation = WPT_VISIBLE_FIELDS.every(
        (f) => getFieldLabel(f, 'en') !== f,
      );
      expect(itHasTranslation).toBe(true);
      expect(enHasTranslation).toBe(true);
      // Any field with an IT translation also has an EN translation (symmetric)
      for (const field of WPT_VISIBLE_FIELDS) {
        const hasIt = getFieldLabel(field, 'it') !== field;
        const hasEn = getFieldLabel(field, 'en') !== field;
        expect(hasIt, `IT missing translation for: ${field}`).toBe(true);
        expect(hasEn, `EN missing translation for: ${field}`).toBe(true);
        // Same key is translated in both locales
        expect(hasIt).toBe(hasEn);
      }
    });
  });

  describe('getAlarmFieldLabels', () => {
    it('returns 5 Italian headers for locale it', () => {
      expect(getAlarmFieldLabels('it')).toHaveLength(5);
    });

    it('returns 5 English headers for locale en', () => {
      expect(getAlarmFieldLabels('en')).toHaveLength(5);
    });

    it('headers are in order: code, description, activated, reset, duration', () => {
      expect(getAlarmFieldLabels('it')).toEqual([
        'Codice Allarme',
        'Descrizione',
        'Attivazione',
        'Reset',
        'Durata',
      ]);
      expect(getAlarmFieldLabels('en')).toEqual([
        'Alarm Code',
        'Description',
        'Activated',
        'Reset',
        'Duration',
      ]);
    });
  });
});
