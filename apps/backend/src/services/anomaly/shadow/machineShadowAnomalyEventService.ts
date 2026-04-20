// ----------------------------------------------------------------------
// Phase 41: Machine Shadow Anomaly Event Service (SHADOW-02, SHADOW-04)
// ----------------------------------------------------------------------
// Persistence layer for shadow events. Writes to machine_anomaly_events_shadow
// (Plan 41-02 hypertable) with detector_variant='shadow-v1' (D-02) and
// tuning_notes JSONB populated at insert time (D-03).
//
// getDiff() implements SHADOW-04 D-22: single UNION ALL + GROUP BY query
// across primary + shadow tables. Bounded time window per D-23.

import { sql } from 'drizzle-orm';
import { z } from 'zod/v4';

import type { IShadowDiffResponse } from '@wpt/types';

import { db } from '../../../db/index.js';
import type { ILiveAnomalyState } from '../types.js';

// WR-03 + WR-04 fix (2026-04-20): runtime Zod validation replaces the
// `as unknown as IDiffRow[]` double cast. The cast silently hid pg row-shape
// drift — if the SQL column names changed (e.g. variant -> kind, flagged ->
// is_flagged) the compiler would not catch it and the downstream fold would
// silently produce NaN or throw TypeError at a distance. The enum pins
// variant to 'primary' | 'shadow' at parse time, so any future 'shadow-v2'
// landing without a schema update fails loud with a clear Zod message instead
// of 'TypeError: Cannot read properties of undefined' at the index site.
// Same fail-loud discipline already applied on the response side at
// anomalyShadow.ts:73 — applied symmetrically here on the DB-row side.
const diffRowSchema = z.object({
  variant:  z.enum(['primary', 'shadow']),
  mode_key: z.string(),
  // pg COUNT returns bigint -> string; Number(x) normalizes at fold time.
  flagged:  z.union([z.string(), z.number()]),
  total:    z.union([z.string(), z.number()]),
});
const diffRowsSchema = z.array(diffRowSchema);
type IDiffRow = z.infer<typeof diffRowSchema>;

export class MachineShadowAnomalyEventService {
  /**
   * D-02 + D-03: INSERT with detector_variant='shadow-v1' and tuning_notes JSONB.
   * tuning_notes is supplied by the caller (shadow service) — it's the result
   * of computeConfigDiff(primary, shadow) cached at service startup.
   */
  static async recordEvent(
    state: ILiveAnomalyState,
    tuningNotes: Record<string, unknown>,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO machine_anomaly_events_shadow (
        observed_at, mode_key, score, flagged, warm,
        sample_count, top_contributors,
        detector_variant, tuning_notes
      ) VALUES (
        ${state.observedAt}::timestamptz,
        ${state.modeKey},
        ${state.score},
        ${state.flagged},
        ${state.warm},
        ${state.sampleCount},
        ${JSON.stringify(state.topContributors)}::jsonb,
        'shadow-v1',
        ${JSON.stringify(tuningNotes)}::jsonb
      )
    `);
  }

  /**
   * SHADOW-04 + D-22: single-round-trip UNION ALL across primary + shadow.
   * GROUP BY (variant, mode_key) with COUNT(*) FILTER (WHERE flagged) produces
   * the two-table diff in one query. In-memory fold assembles the D-21 shape.
   *
   * D-23: window bounded by `from`/`to` (caller defaults: now() - 24h, now()).
   * Optional modeKey filter narrows BOTH sides symmetrically — never asymmetric
   * (would make the diff nonsensical).
   */
  static async getDiff(args: {
    from: Date;
    to: Date;
    modeKey?: string;
  }): Promise<IShadowDiffResponse> {
    const { from, to, modeKey } = args;

    const modeFilter = modeKey
      ? sql`AND mode_key = ${modeKey}`
      : sql``;

    // pg driver: db.execute() returns QueryResult<{ rows, rowCount, ... }>.
    // The array lives on .rows — destructure before the in-memory fold.
    const result = await db.execute(sql`
      WITH unioned AS (
        SELECT 'primary'::text AS variant, mode_key, flagged
        FROM machine_anomaly_events
        WHERE observed_at >= ${from.toISOString()}::timestamptz
          AND observed_at <= ${to.toISOString()}::timestamptz
          ${modeFilter}
        UNION ALL
        SELECT 'shadow'::text AS variant, mode_key, flagged
        FROM machine_anomaly_events_shadow
        WHERE observed_at >= ${from.toISOString()}::timestamptz
          AND observed_at <= ${to.toISOString()}::timestamptz
          ${modeFilter}
      )
      SELECT variant, mode_key,
             COUNT(*) FILTER (WHERE flagged) AS flagged,
             COUNT(*) AS total
      FROM unioned
      GROUP BY variant, mode_key
      ORDER BY mode_key, variant
    `);
    // WR-03: fail loud on pg row-shape drift. WR-04: z.enum pins variant so
    // a future 'shadow-v2' landing without a schema bump fails here with a
    // clear Zod message, not with a TypeError at the downstream index site.
    const rows: IDiffRow[] = diffRowsSchema.parse(result.rows);

    // In-memory fold into IShadowDiffResponse
    type Counts = { flagged: number; total: number };
    const byMode = new Map<string, { primary: Counts; shadow: Counts }>();
    const totals: { primary: Counts; shadow: Counts } = {
      primary: { flagged: 0, total: 0 },
      shadow: { flagged: 0, total: 0 },
    };

    for (const row of rows) {
      const flagged = Number(row.flagged);
      const total = Number(row.total);
      totals[row.variant].flagged += flagged;
      totals[row.variant].total += total;

      const existing = byMode.get(row.mode_key) ?? {
        primary: { flagged: 0, total: 0 },
        shadow: { flagged: 0, total: 0 },
      };
      existing[row.variant] = { flagged, total };
      byMode.set(row.mode_key, existing);
    }

    const byModeKey = [...byMode.entries()]
      .map(([mk, v]) => ({ modeKey: mk, primary: v.primary, shadow: v.shadow }))
      .sort((a, b) => a.modeKey.localeCompare(b.modeKey));

    return {
      totals,
      byModeKey,
      window: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    };
  }
}
