import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../../drizzle/0003_shadow_anomaly_events.sql', import.meta.url);
const journalUrl = new URL('../../drizzle/meta/_journal.json', import.meta.url);

describe('fresh-volume Timescale bootstrap migration', () => {
  it('creates the shadow anomaly table before Timescale setup runs', () => {
    expect(existsSync(migrationUrl)).toBe(true);

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "machine_anomaly_events_shadow"');
    expect(migration).toContain('timestamp with time zone');

    const journal = readFileSync(journalUrl, 'utf8');
    expect(journal).toContain('0003_shadow_anomaly_events');
  });
});
