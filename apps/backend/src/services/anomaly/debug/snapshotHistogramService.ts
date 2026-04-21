// ----------------------------------------------------------------------
// Phase 43 D-15: Snapshot histogram query service
// ----------------------------------------------------------------------
// Powers GET /api/anomaly/debug/snapshot-histogram. One bucket per hour
// via TimescaleDB time_bucket() on the machine_snapshots hypertable.
// Extracted from routes/anomalyDebug.ts (Approach A) so the route layer
// stays test-pure (mock the service) and integration coverage lives in
// services/anomaly/debug/**.test.ts against real Docker PG.
//
// No in-repo precedent for time_bucket() inside application code —
// only docker/init-timescaledb.sql:162 uses it (for materialized views).
// Query written from scratch against TimescaleDB docs + parametrized via
// Drizzle's sql`` tagged template (zero string interpolation).

import { sql } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import type { ISnapshotHistogramResponse } from '@wpt/types';

export class SnapshotHistogramService {
  /**
   * Returns hourly snapshot counts within [from, to). Empty buckets
   * are omitted (no server-side zero-fill — frontend renders gaps as
   * 0-height bars per D-16, but the API contract lists only populated
   * hours).
   *
   * @param fromIso — inclusive lower bound (ISO datetime string).
   * @param toIso   — exclusive upper bound (ISO datetime string).
   */
  static async fetch(fromIso: string, toIso: string): Promise<ISnapshotHistogramResponse> {
    const from = new Date(fromIso);
    const to = new Date(toIso);

    // TimescaleDB time_bucket + COUNT per hour. Chunk exclusion on the
    // hypertable makes this scan cost O(hours in range).
    const result = await db.execute<{ bucket: Date | string; count: string | number }>(sql`
      SELECT time_bucket('1 hour', "timestamp") AS bucket,
             COUNT(*)::bigint AS count
      FROM machine_snapshots
      WHERE "timestamp" >= ${from} AND "timestamp" < ${to}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);

    const buckets = (result.rows as Array<{ bucket: Date | string; count: string | number }>).map(
      (row) => ({
        bucket: (row.bucket instanceof Date ? row.bucket : new Date(row.bucket)).toISOString(),
        count: Number(row.count),
      }),
    );
    const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);

    return { buckets, totalCount };
  }
}
