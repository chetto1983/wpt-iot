/**
 * Shared date utilities used across report/alarm/chart pages.
 *
 * Extracted from alarms/page.tsx and reports/page.tsx to eliminate
 * duplicated buildDateTimeISO implementations (Phase 28-04).
 */

/**
 * Combine a Date (for the calendar day) with a time string "HH:mm"
 * and return a full ISO 8601 timestamp.
 *
 * Used by alarms and reports pages to build query parameters from
 * separate date-range and time inputs.
 */
export function buildDateTimeISO(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}
