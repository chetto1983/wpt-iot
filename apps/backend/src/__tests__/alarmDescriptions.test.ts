import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('alarmDescriptions', () => {
  it('should throw if getAlarmDescription is called before loading', async () => {
    // Fresh import to get unloaded state — use dynamic import with cache bust
    const mod = await import('../i18n/alarmDescriptions.js');
    // We need a way to test the "not loaded" state. Since modules are cached,
    // we test by verifying the module exports exist. The actual throw test
    // requires a fresh module instance. We'll test this conceptually:
    // calling getAlarmDescription before loadAlarmDescriptions should throw.
    // However, since other tests call load first and modules are singletons,
    // we test this first before any load calls.
    expect(() => mod.getAlarmDescription(0, 'en')).toThrow('not loaded');
  });

  describe('after loading', () => {
    let loadAlarmDescriptions: () => void;
    let getAlarmDescription: (index: number, locale: 'it' | 'en') => string;

    beforeAll(async () => {
      const mod = await import('../i18n/alarmDescriptions.js');
      loadAlarmDescriptions = mod.loadAlarmDescriptions;
      getAlarmDescription = mod.getAlarmDescription;
      loadAlarmDescriptions();
    });

    it('loadAlarmDescriptions() succeeds without throwing', () => {
      // If we got here, loading succeeded in beforeAll
      expect(true).toBe(true);
    });

    it('getAlarmDescription(0, "en") returns a non-empty string containing EMERGENCY', () => {
      const desc = getAlarmDescription(0, 'en');
      expect(desc).toBeTruthy();
      expect(desc).toContain('EMERGENCY');
    });

    it('getAlarmDescription(0, "it") returns a non-empty string containing EMERGENZA', () => {
      const desc = getAlarmDescription(0, 'it');
      expect(desc).toBeTruthy();
      expect(desc).toContain('EMERGENZA');
    });

    it('getAlarmDescription(22, "en") returns "A0023" for an empty alarm slot', () => {
      // Index 22 = alarm code A0023 (0-based: 22+1=23, padded to 4 digits)
      const desc = getAlarmDescription(22, 'en');
      expect(desc).toBe('A0023');
    });

    it('getAlarmDescription(639, "en") returns either a description or "A0640" fallback', () => {
      const desc = getAlarmDescription(639, 'en');
      expect(desc).toBeTruthy();
      // Either a real description or the fallback format
      expect(typeof desc).toBe('string');
    });

    it('getAlarmDescription(9999, "en") returns "A10000" for out-of-range', () => {
      const desc = getAlarmDescription(9999, 'en');
      expect(desc).toBe('A10000');
    });

    it('en.json has exactly 640 keys', () => {
      const enPath = join(__dirname, '..', 'i18n', 'alarms', 'en.json');
      const data = JSON.parse(readFileSync(enPath, 'utf-8')) as Record<string, string>;
      expect(Object.keys(data).length).toBe(640);
    });

    it('it.json has exactly 640 keys', () => {
      const itPath = join(__dirname, '..', 'i18n', 'alarms', 'it.json');
      const data = JSON.parse(readFileSync(itPath, 'utf-8')) as Record<string, string>;
      expect(Object.keys(data).length).toBe(640);
    });
  });
});
