/**
 * Shared chart formatting utilities used by panel-chart.tsx and charts/page.tsx.
 *
 * Extracted to eliminate duplicated formatTick implementations (Phase 28-04).
 */

import {
  DEFAULT_TIMEZONE,
  formatZonedDate,
  formatZonedTime,
} from '@wpt/types';

/**
 * Format an epoch-ms timestamp for X-axis ticks based on chart resolution.
 *
 * - raw (15s snapshots): show HH:mm:ss
 * - 5min aggregates: show HH:mm
 * - 1h aggregates: show dd/MM HH:mm
 * - 1d aggregates: show dd/MM/yyyy
 */
export function formatTick(
  epochMs: number,
  resolution: string,
  timezone = DEFAULT_TIMEZONE,
): string {
  const d = new Date(epochMs);
  if (resolution === 'raw') return formatZonedTime(d, timezone, true);
  if (resolution === '5min') return formatZonedTime(d, timezone);
  if (resolution === '1d') return formatZonedDate(d, timezone);
  return `${formatZonedDate(d, timezone).slice(0, 5)} ${formatZonedTime(d, timezone)}`;
}
