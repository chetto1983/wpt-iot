import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  formatZonedDateTime,
  getZonedMonthRange,
  isValidTimezone,
  resolveTimezone,
  zonedDateTimeToUtc,
} from '../timezone.js';

describe('timezone helpers', () => {
  it('validates IANA timezone names and falls back safely', () => {
    expect(isValidTimezone('Europe/Rome')).toBe(true);
    expect(isValidTimezone('Invalid/Timezone')).toBe(false);
    expect(resolveTimezone('Invalid/Timezone')).toBe(DEFAULT_TIMEZONE);
  });

  it('formats an instant in the configured timezone with DST', () => {
    const instant = new Date('2026-08-28T12:08:30.000Z');
    expect(formatZonedDateTime(instant, 'Europe/Rome', true)).toBe(
      '28/08/2026 14:08:30',
    );
    expect(formatZonedDateTime(instant, 'UTC', true)).toBe(
      '28/08/2026 12:08:30',
    );
  });

  it('converts Rome wall-clock time to UTC in summer and winter', () => {
    expect(
      zonedDateTimeToUtc(
        { year: 2026, month: 8, day: 28, hour: 0, minute: 0 },
        'Europe/Rome',
      ).toISOString(),
    ).toBe('2026-08-27T22:00:00.000Z');

    expect(
      zonedDateTimeToUtc(
        { year: 2026, month: 1, day: 15, hour: 0, minute: 0 },
        'Europe/Rome',
      ).toISOString(),
    ).toBe('2026-01-14T23:00:00.000Z');
  });

  it('creates an exclusive month range in the configured timezone', () => {
    const range = getZonedMonthRange(2026, 8, 'Europe/Rome');
    expect(range.from.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-08-31T22:00:00.000Z');
  });
});
