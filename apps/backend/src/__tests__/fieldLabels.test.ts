import { describe, it } from 'vitest';

describe('fieldLabels (I18N-04)', () => {
  describe('getFieldLabel', () => {
    it.todo('returns Italian label for garbageTemp when locale is it');
    it.todo('returns English label for garbageTemp when locale is en');
    it.todo('returns the raw field name when no translation exists');
    it.todo('has translations for all 42 WPT_VISIBLE_FIELDS plus timestamp');
    it.todo('Italian and English maps have identical key sets');
  });

  describe('getAlarmFieldLabels', () => {
    it.todo('returns 5 Italian headers for locale it');
    it.todo('returns 5 English headers for locale en');
    it.todo('headers are in order: code, description, activated, reset, duration');
  });
});
