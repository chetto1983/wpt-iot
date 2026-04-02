import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type AlarmMap = Map<number, string>;

let itMap: AlarmMap | null = null;
let enMap: AlarmMap | null = null;

function loadMap(locale: 'it' | 'en'): AlarmMap {
  const filePath = join(__dirname, 'alarms', `${locale}.json`);
  const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>;
  const map = new Map<number, string>();
  for (const [key, value] of Object.entries(raw)) {
    map.set(Number(key), value);
  }
  return map;
}

/** Call once at startup. Throws if JSON files are missing. */
export function loadAlarmDescriptions(): void {
  itMap = loadMap('it');
  enMap = loadMap('en');
}

/**
 * Get alarm description by index and locale.
 * Falls back to "A{NNNN}" format for missing/empty descriptions.
 * Per D-03: looked up at write time in alarmStore.
 */
export function getAlarmDescription(index: number, locale: 'it' | 'en'): string {
  const map = locale === 'it' ? itMap : enMap;
  if (!map) throw new Error('Alarm descriptions not loaded -- call loadAlarmDescriptions() first');
  const desc = map.get(index);
  if (!desc) return `A${String(index + 1).padStart(4, '0')}`;
  return desc;
}
