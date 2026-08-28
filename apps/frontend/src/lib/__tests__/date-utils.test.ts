import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildDateTimeISO,
  formatCalendarDateParam,
  formatZonedDateTimeLocal,
  parseCalendarDateParam,
  parseZonedDateTimeLocal,
  toZonedCalendarDate,
} from '../date-utils';

describe('buildDateTimeISO', () => {
  const originalTimezone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  afterEach(() => {
    process.env.TZ = originalTimezone;
  });

  it('treats a date-only query value as a wall-clock day in the configured timezone', () => {
    expect(buildDateTimeISO('2026-08-28', '00:00', 'Asia/Tokyo')).toBe(
      '2026-08-27T15:00:00.000Z',
    );
  });

  it('round-trips date-only values without applying the browser timezone', () => {
    const date = parseCalendarDateParam('2026-08-28');

    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([
      2026, 8, 28,
    ]);
    expect(formatCalendarDateParam(date)).toBe('2026-08-28');
  });

  it('creates a calendar-safe Date with fields from the configured timezone', () => {
    const date = toZonedCalendarDate(
      new Date('2026-08-28T01:30:00.000Z'),
      'Asia/Tokyo',
    );

    expect([
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
    ]).toEqual([2026, 8, 28, 10, 30]);
  });

  it('round-trips datetime-local values through a UTC instant', () => {
    const instant = new Date('2026-08-27T15:30:00.000Z');

    expect(formatZonedDateTimeLocal(instant, 'Asia/Tokyo')).toBe(
      '2026-08-28T00:30',
    );
    expect(
      parseZonedDateTimeLocal('2026-08-28T00:30', 'Asia/Tokyo')?.toISOString(),
    ).toBe(instant.toISOString());
  });
});
