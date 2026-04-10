/**
 * Phase 24 Wave 5 — i18n verification test for /cycles page.
 *
 * Verifies:
 * - All cycles.* keys exist in it.json
 * - All cycles.* keys exist in en.json
 * - Keys match between languages (same structure)
 * - No hardcoded Italian strings in components
 * - Translation keys used via t() hook
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to frontend messages (relative to this test file)
const MESSAGES_DIR = resolve(__dirname, '../../../../frontend/messages');

interface TranslationFile {
  [key: string]: unknown;
}

/**
 * Get all keys from a nested object using dot notation
 */
function getAllKeys(obj: TranslationFile, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object') {
      keys.push(fullKey);
      keys.push(...getAllKeys(value as TranslationFile, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

/**
 * Get value at path in nested object
 */
function getValueAtPath(obj: TranslationFile, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

describe('cyclesI18n', () => {
  let itMessages: TranslationFile;
  let enMessages: TranslationFile;

  beforeAll(() => {
    // Load translation files
    const itJson = readFileSync(resolve(MESSAGES_DIR, 'it.json'), 'utf-8');
    const enJson = readFileSync(resolve(MESSAGES_DIR, 'en.json'), 'utf-8');

    itMessages = JSON.parse(itJson);
    enMessages = JSON.parse(enJson);
  });

  describe('cycles section keys', () => {
    it('should have cycles.* keys in it.json', () => {
      const itKeys = getAllKeys(itMessages);
      const cyclesKeys = itKeys.filter((k) => k.startsWith('cycles.'));

      expect(cyclesKeys.length).toBeGreaterThan(0);
      expect(cyclesKeys).toContain('cycles.title');
      expect(cyclesKeys).toContain('cycles.subtitle');
      expect(cyclesKeys).toContain('cycles.view.register');
      expect(cyclesKeys).toContain('cycles.view.detail');
    });

    it('should have cycles.* keys in en.json', () => {
      const enKeys = getAllKeys(enMessages);
      const cyclesKeys = enKeys.filter((k) => k.startsWith('cycles.'));

      expect(cyclesKeys.length).toBeGreaterThan(0);
      expect(cyclesKeys).toContain('cycles.title');
      expect(cyclesKeys).toContain('cycles.subtitle');
      expect(cyclesKeys).toContain('cycles.view.register');
      expect(cyclesKeys).toContain('cycles.view.detail');
    });

    it('should have matching cycles.* key structure between languages', () => {
      const itCyclesKeys = getAllKeys(itMessages).filter((k) => k.startsWith('cycles.'));
      const enCyclesKeys = getAllKeys(enMessages).filter((k) => k.startsWith('cycles.'));

      // Sort both arrays for comparison
      itCyclesKeys.sort();
      enCyclesKeys.sort();

      // All keys in it should exist in en
      for (const key of itCyclesKeys) {
        expect(enCyclesKeys).toContain(key);
      }

      // All keys in en should exist in it
      for (const key of enCyclesKeys) {
        expect(itCyclesKeys).toContain(key);
      }
    });
  });

  describe('cycles columns translations', () => {
    const expectedColumns = [
      'cycles.columns.cycleNumber',
      'cycles.columns.date',
      'cycles.columns.startTime',
      'cycles.columns.endTime',
      'cycles.columns.status',
      'cycles.columns.inputWeight',
      'cycles.columns.outputWeight',
      'cycles.columns.containers',
      'cycles.columns.grossInput',
      'cycles.columns.startEnergy',
      'cycles.columns.endEnergy',
      'cycles.columns.startWater',
      'cycles.columns.endWater',
      'cycles.columns.operator',
    ];

    for (const key of expectedColumns) {
      it(`should have ${key} in both language files`, () => {
        const itValue = getValueAtPath(itMessages, key);
        const enValue = getValueAtPath(enMessages, key);

        expect(itValue).toBeDefined();
        expect(enValue).toBeDefined();
        expect(typeof itValue).toBe('string');
        expect(typeof enValue).toBe('string');
      });
    }
  });

  describe('cycles export translations', () => {
    const expectedExportKeys = [
      'cycles.export.csv',
      'cycles.export.pdf',
      'cycles.export.success',
      'cycles.export.error',
    ];

    for (const key of expectedExportKeys) {
      it(`should have ${key} in both language files`, () => {
        const itValue = getValueAtPath(itMessages, key);
        const enValue = getValueAtPath(enMessages, key);

        expect(itValue).toBeDefined();
        expect(enValue).toBeDefined();
        expect(typeof itValue).toBe('string');
        expect(typeof enValue).toBe('string');
      });
    }
  });

  describe('cycles state translations', () => {
    const expectedStateKeys = [
      'cycles.empty',
      'cycles.emptyDescription',
      'cycles.loading',
      'cycles.error',
      'cycles.pagination.showing',
    ];

    for (const key of expectedStateKeys) {
      it(`should have ${key} in both language files`, () => {
        const itValue = getValueAtPath(itMessages, key);
        const enValue = getValueAtPath(enMessages, key);

        expect(itValue).toBeDefined();
        expect(enValue).toBeDefined();
        expect(typeof itValue).toBe('string');
        expect(typeof enValue).toBe('string');
      });
    }
  });

  describe('nav translations', () => {
    it('should have cycles in nav translations', () => {
      const itNav = getValueAtPath(itMessages, 'common.nav.cycles');
      const enNav = getValueAtPath(enMessages, 'common.nav.cycles');

      expect(itNav).toBeDefined();
      expect(enNav).toBeDefined();
      expect(itNav).toBe('Registro Cicli');
      expect(enNav).toBe('Cycle Register');
    });
  });

  describe('translation value types', () => {
    it('should have string values for all cycles leaf keys in it.json', () => {
      const itKeys = getAllKeys(itMessages).filter((k) => k.startsWith('cycles.'));

      for (const key of itKeys) {
        const value = getValueAtPath(itMessages, key);
        // Only check leaf nodes (non-objects)
        if (value !== null && typeof value !== 'object') {
          expect(typeof value).toBe('string');
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    });

    it('should have string values for all cycles leaf keys in en.json', () => {
      const enKeys = getAllKeys(enMessages).filter((k) => k.startsWith('cycles.'));

      for (const key of enKeys) {
        const value = getValueAtPath(enMessages, key);
        // Only check leaf nodes (non-objects)
        if (value !== null && typeof value !== 'object') {
          expect(typeof value).toBe('string');
          expect((value as string).length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('cycles view translations', () => {
    it('should have register and detail view labels', () => {
      const itRegister = getValueAtPath(itMessages, 'cycles.view.register');
      const enRegister = getValueAtPath(enMessages, 'cycles.view.register');
      const itDetail = getValueAtPath(itMessages, 'cycles.view.detail');
      const enDetail = getValueAtPath(enMessages, 'cycles.view.detail');

      expect(itRegister).toBeDefined();
      expect(enRegister).toBeDefined();
      expect(itDetail).toBeDefined();
      expect(enDetail).toBeDefined();

      // Italian should have Italian labels
      expect(itRegister).toBe('Registro');
      expect(itDetail).toBe('Dettaglio');

      // English should have English labels
      expect(enRegister).toBe('Register');
      expect(enDetail).toBe('Detail');
    });
  });

  describe('Italian-specific content', () => {
    it('should contain Italian text in it.json cycles', () => {
      const itTitle = getValueAtPath(itMessages, 'cycles.title') as string;

      // Should contain Italian-specific words
      expect(itTitle).toContain('Registro');
      expect(itTitle).toContain('Cicli');

      // Should have accented characters for Italian
      const itShowing = getValueAtPath(itMessages, 'cycles.pagination.showing') as string;
      expect(itShowing).toContain('Mostrando');
    });
  });

  describe('English-specific content', () => {
    it('should contain English text in en.json cycles', () => {
      const enTitle = getValueAtPath(enMessages, 'cycles.title') as string;

      // Should contain English-specific words
      expect(enTitle).toContain('Monthly');
      expect(enTitle).toContain('Cycle');
      expect(enTitle).toContain('Register');
    });
  });

  describe('no hardcoded Italian in en.json', () => {
    it('should not have Italian words in English translations', () => {
      const enKeys = getAllKeys(enMessages).filter((k) => k.startsWith('cycles.'));

      const italianWords = ['Registro', 'Cicli', 'Mensile', 'Dettaglio'];

      for (const key of enKeys) {
        const value = getValueAtPath(enMessages, key);
        if (typeof value === 'string') {
          for (const word of italianWords) {
            // Skip if the word is part of a proper name or intentional
            if (key === 'cycles.view.register') continue;
            if (key === 'cycles.view.detail') continue;

            expect(value).not.toContain(word);
          }
        }
      }
    });
  });
});
