/**
 * Shared date utilities used across report/alarm/chart pages.
 *
 * Extracted from alarms/page.tsx and reports/page.tsx to eliminate
 * duplicated buildDateTimeISO implementations (Phase 28-04).
 */

import {
  DEFAULT_TIMEZONE,
  getZonedDateTimeParts,
  zonedDateTimeToUtc,
} from '@wpt/types';

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Parse YYYY-MM-DD as calendar fields, never as a browser-timezone instant. */
export function parseCalendarDateParam(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

/** Format a calendar-picker Date without converting it through UTC. */
export function formatCalendarDateParam(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Build a Date whose browser-local fields mirror an instant in an IANA zone.
 * This is only an adapter for calendar controls; it must not be persisted.
 */
export function toZonedCalendarDate(date: Date, timezone: string): Date {
  const parts = getZonedDateTimeParts(date, timezone);
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** Format a UTC instant for an HTML datetime-local input in the app timezone. */
export function formatZonedDateTimeLocal(date: Date, timezone: string): string {
  const parts = getZonedDateTimeParts(date, timezone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Convert an HTML datetime-local wall time to the UTC instant sent to the API. */
export function parseZonedDateTimeLocal(
  value: string,
  timezone: string,
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return zonedDateTimeToUtc(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
    },
    timezone,
  );
}

/**
 * Combine a Date (for the calendar day) with a time string "HH:mm"
 * and return a full ISO 8601 timestamp.
 *
 * Used by alarms and reports pages to build query parameters from
 * separate date-range and time inputs.
 */
export function buildDateTimeISO(
  date: Date | string,
  time: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  const [h, m] = time.split(':').map(Number);
  const [year, month, day] =
    typeof date === 'string'
      ? date.split('-').map(Number)
      : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return zonedDateTimeToUtc(
    {
      year: year ?? 0,
      month: month ?? 1,
      day: day ?? 1,
      hour: h ?? 0,
      minute: m ?? 0,
    },
    timezone,
  ).toISOString();
}
