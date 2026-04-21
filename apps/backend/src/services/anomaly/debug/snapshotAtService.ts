// ----------------------------------------------------------------------
// Phase 43 D-26 hop 3: Nearest-snapshot query service
// ----------------------------------------------------------------------
// Powers GET /api/anomaly/debug/snapshot?at=ISO. Returns the nearest
// machine_snapshots row within ±30s tolerance of the requested `at`
// timestamp, or null when no row is within the window.
//
// Extracted from routes/anomalyDebug.ts (Approach A) so the route layer
// stays test-pure (mock the service) and integration coverage lives in
// services/anomaly/debug/**.test.ts against real Docker PG.
//
// The ±30s tolerance window is narrow (60s total span) → typical 5-15s
// PLC cadence gives ≤6 candidate rows. Bounded indexed range scan via
// machine_snapshots_timestamp_idx (schema/machine.ts:121), then JS
// nearest-neighbour reduce.

import { and, asc, gte, lte } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { machineSnapshots } from '../../../db/schema/machine.js';
import type { IDebugSnapshotAtResponse } from '@wpt/types';

export const SNAPSHOT_AT_TOLERANCE_MS = 30_000;

export class SnapshotAtService {
  /**
   * Returns the nearest machine_snapshots row to `at` within ±30s, or null
   * when no row is within tolerance.
   *
   * @param atIso — target timestamp (ISO datetime string).
   */
  static async fetch(atIso: string): Promise<IDebugSnapshotAtResponse | null> {
    const at = new Date(atIso);
    const lowerBound = new Date(at.getTime() - SNAPSHOT_AT_TOLERANCE_MS);
    const upperBound = new Date(at.getTime() + SNAPSHOT_AT_TOLERANCE_MS);

    const rows = await db
      .select()
      .from(machineSnapshots)
      .where(
        and(
          gte(machineSnapshots.timestamp, lowerBound),
          lte(machineSnapshots.timestamp, upperBound),
        ),
      )
      .orderBy(asc(machineSnapshots.timestamp));

    if (rows.length === 0) return null;

    // Nearest-neighbour pick (reduce's first-wins resolves ties to the earliest row).
    const nearest = rows.reduce((best, row) => {
      const bestDelta = Math.abs(best.timestamp.getTime() - at.getTime());
      const rowDelta = Math.abs(row.timestamp.getTime() - at.getTime());
      return rowDelta < bestDelta ? row : best;
    });

    // Split id + timestamp from the rest; `values` carries everything else.
    const { id, timestamp: ts, ...rest } = nearest;
    const values: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === null) values[k] = null;
      else if (typeof v === 'number' || typeof v === 'string') values[k] = v;
      // Booleans, Dates, and objects intentionally dropped — machine_snapshots
      // rest columns are already integer/real/smallint/varchar per schema, so
      // this is belt-and-suspenders against a future schema addition with a
      // non-serializable type.
    }

    return {
      timestamp: ts.toISOString(),
      id,
      values,
    };
  }
}
