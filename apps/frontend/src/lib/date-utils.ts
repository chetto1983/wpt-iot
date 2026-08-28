/**
 * Shared date utilities used across report/alarm/chart pages.
 *
 * Extracted from alarms/page.tsx and reports/page.tsx to eliminate
 * duplicated buildDateTimeISO implementations (Phase 28-04).
 */

import { DEFAULT_TIMEZONE, zonedDateTimeToUtc } from '@wpt/types';

/**
 * Combine a Date (for the calendar day) with a time string "HH:mm"
 * and return a full ISO 8601 timestamp.
 *
 * Used by alarms and reports pages to build query parameters from
 * separate date-range and time inputs.
 */
export function buildDateTimeISO(
  date: Date,
  time: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  const [h, m] = time.split(':').map(Number);
  return zonedDateTimeToUtc(
    {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: h ?? 0,
      minute: m ?? 0,
    },
    timezone,
  ).toISOString();
}
