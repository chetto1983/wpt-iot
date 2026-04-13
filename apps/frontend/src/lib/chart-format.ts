/**
 * Shared chart formatting utilities used by panel-chart.tsx and charts/page.tsx.
 *
 * Extracted to eliminate duplicated formatTick implementations (Phase 28-04).
 */

import { format } from 'date-fns';

/**
 * Format an epoch-ms timestamp for X-axis ticks based on chart resolution.
 *
 * - raw (15s snapshots): show HH:mm:ss
 * - 5min aggregates: show HH:mm
 * - 1h aggregates: show dd/MM HH:mm
 */
export function formatTick(epochMs: number, resolution: string): string {
  const d = new Date(epochMs);
  if (resolution === 'raw') return format(d, 'HH:mm:ss');
  if (resolution === '5min') return format(d, 'HH:mm');
  return format(d, 'dd/MM HH:mm');
}
