import type { UMetric } from 'sparkplug-payload/lib/sparkplugbpayload.js';
import type { IAlarmTransition } from '../events/types.js';

/**
 * Sparkplug B "alarms" device helpers (Phase 37 Plan 02, D-06).
 *
 * Extracted from sparkplugService.ts to keep that file under the 500-line cap
 * (CLAUDE.md hard rule) while hosting the 44-entry alias block, the bitmask
 * plumbing, and the DBIRTH / DDATA metric builders.
 *
 * Layout decision — bitmask-per-word (40 metrics × Int32) over bit-per-metric
 * (640 boolean metrics): justification in 37-02-PLAN.md header. Native PLC
 * encoding, consumer ergonomics, wire-size ~160 bytes per NDATA vs. ~10 KB
 * for a bit-per-metric DBIRTH.
 *
 * Exposed contract:
 *   - `ALARM_ALIASES`             — 44 frozen alias entries (300..343),
 *                                    spread into ALIAS_MAP in sparkplugService
 *   - `bitmaskFromIndices(...)`   — active-alarm index list → 40-word bitmask
 *   - `buildAlarmsDbirthMetrics`  — 44-metric DBIRTH payload (name + alias)
 *   - `buildAlarmsDdataMetrics`   — alias-only DDATA: changed words + 4 last_event
 */

/**
 * 44-entry alarm alias slice. alarms/word_0..alarms/word_39 occupy 300..339;
 * 340..343 are the four last_event / active_count scalars.
 */
export const ALARM_ALIASES: Readonly<Record<string, number>> = Object.freeze(
  (() => {
    const out: Record<string, number> = {};
    for (let w = 0; w < 40; w++) {
      out[`alarms/word_${String(w)}`] = 300 + w;
    }
    out['alarms/last_event_code'] = 340;
    out['alarms/last_event_state'] = 341;
    out['alarms/last_event_at'] = 342;
    out['alarms/active_count'] = 343;
    return out;
  })(),
);

/**
 * Reduce a flat list of active alarm indices (0..639) into the 40-word INT16
 * bitmask the PLC emits on UDP 9091. Indices out of range are silently dropped
 * (defensive — the diff pipeline already guards the range, but the helper
 * must never throw on stale/garbled state).
 *
 * word index = floor(index / 16), bit index = index % 16.
 */
export function bitmaskFromIndices(indices: readonly number[]): number[] {
  const words = new Array<number>(40).fill(0);
  for (const idx of indices) {
    if (idx < 0 || idx >= 640) continue;
    const w = Math.floor(idx / 16);
    const b = idx % 16;
    // INT16 width on the wire; mask defensively even though 1 << 15 already fits.
    words[w] = ((words[w] ?? 0) | (1 << b)) & 0xffff;
  }
  return words;
}

/** Narrow alias-lookup helper constrained to the alarms namespace. */
function alarmAlias(name: keyof typeof ALARM_ALIASES | string): number {
  const v = (ALARM_ALIASES as Record<string, number>)[name];
  if (v === undefined) throw new Error(`Unknown alarm metric alias for "${name}"`);
  return v;
}

/**
 * Build the full DBIRTH metric set for the `/alarms` device. Emits 44 metrics
 * (40 word-bitmask + 4 last_event / active_count), each carrying `name + alias`
 * per Sparkplug B 3.0 §6.4.4 birth contract.
 */
export function buildAlarmsDbirthMetrics(
  initialBitmask: readonly number[],
  activeCount: number,
): UMetric[] {
  const metrics: UMetric[] = [];
  for (let w = 0; w < 40; w++) {
    metrics.push({
      name: `alarms/word_${String(w)}`,
      alias: alarmAlias(`alarms/word_${String(w)}`),
      type: 'Int32',
      value: initialBitmask[w] ?? 0,
    });
  }
  // DBIRTH sentinel: -1 means "no alarm event has occurred since the IoT box started".
  // Consumers MUST treat -1 as the "no data" state, not as a valid alarm index.
  metrics.push({ name: 'alarms/last_event_code', alias: alarmAlias('alarms/last_event_code'), type: 'Int32', value: -1 });
  metrics.push({ name: 'alarms/last_event_state', alias: alarmAlias('alarms/last_event_state'), type: 'Int32', value: 0 });
  metrics.push({ name: 'alarms/last_event_at', alias: alarmAlias('alarms/last_event_at'), type: 'DateTime', value: 0 });
  metrics.push({ name: 'alarms/active_count', alias: alarmAlias('alarms/active_count'), type: 'Int32', value: activeCount });
  return metrics;
}

/**
 * Build the alias-only DDATA metric set for an alarm transition batch. Emits:
 *   - one Int32 per word whose bitmask changed since `lastBitmask`
 *   - the 4 last_event scalars derived from the final batch entry + activeCount
 *
 * Returns an empty array when no words changed AND no final transition was
 * provided — caller is expected to check transitions.length upstream, but the
 * helper is safe on (newBitmask === lastBitmask, last === undefined) as well.
 */
export function buildAlarmsDdataMetrics(
  newBitmask: readonly number[],
  lastBitmask: readonly number[],
  last: IAlarmTransition,
  activeCount: number,
): UMetric[] {
  const metrics: UMetric[] = [];
  for (let w = 0; w < 40; w++) {
    if ((newBitmask[w] ?? 0) !== (lastBitmask[w] ?? 0)) {
      metrics.push({
        alias: alarmAlias(`alarms/word_${String(w)}`),
        type: 'Int32',
        value: newBitmask[w] ?? 0,
      });
    }
  }
  metrics.push({ alias: alarmAlias('alarms/last_event_code'), type: 'Int32', value: last.alarmIndex });
  metrics.push({ alias: alarmAlias('alarms/last_event_state'), type: 'Int32', value: last.active ? 1 : 0 });
  metrics.push({ alias: alarmAlias('alarms/last_event_at'), type: 'DateTime', value: last.timestamp.getTime() });
  metrics.push({ alias: alarmAlias('alarms/active_count'), type: 'Int32', value: activeCount });
  return metrics;
}
