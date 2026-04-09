import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { ILiveAnomalyState } from './machineAnomalyService.js';

export interface IMachineAnomalyEvent {
  id: number;
  observedAt: string;
  modeKey: string;
  score: number;
  flagged: boolean;
  warm: boolean;
  sampleCount: number;
  topContributors: Array<{ feature: string; zScore: number }>;
  createdAt: string;
}

interface IEventRow {
  id: number | string;
  observed_at: Date | string;
  mode_key: string;
  score: number | string;
  flagged: boolean;
  warm: boolean;
  sample_count: number | string;
  top_contributors: unknown;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: IEventRow): IMachineAnomalyEvent {
  return {
    id: Number(row.id),
    observedAt: asIso(row.observed_at),
    modeKey: row.mode_key,
    score: Number(row.score),
    flagged: Boolean(row.flagged),
    warm: Boolean(row.warm),
    sampleCount: Number(row.sample_count),
    topContributors: Array.isArray(row.top_contributors)
      ? (row.top_contributors as Array<{ feature: string; zScore: number }>)
      : [],
    createdAt: asIso(row.created_at),
  };
}

export class MachineAnomalyEventService {
  static async ensureSchema(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS machine_anomaly_events (
        id BIGSERIAL PRIMARY KEY,
        observed_at TIMESTAMPTZ NOT NULL,
        mode_key TEXT NOT NULL,
        score REAL NOT NULL,
        flagged BOOLEAN NOT NULL,
        warm BOOLEAN NOT NULL,
        sample_count INTEGER NOT NULL,
        top_contributors JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS machine_anomaly_events_observed_at_idx
        ON machine_anomaly_events (observed_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS machine_anomaly_events_flagged_idx
        ON machine_anomaly_events (flagged, observed_at DESC)
    `);
  }

  static async recordEvent(state: ILiveAnomalyState): Promise<void> {
    await db.execute(sql`
      INSERT INTO machine_anomaly_events (
        observed_at,
        mode_key,
        score,
        flagged,
        warm,
        sample_count,
        top_contributors
      ) VALUES (
        ${state.observedAt}::timestamptz,
        ${state.modeKey},
        ${state.score},
        ${state.flagged},
        ${state.warm},
        ${state.sampleCount},
        ${JSON.stringify(state.topContributors)}::jsonb
      )
    `);
  }

  static async listRecent(args?: {
    limit?: number;
    flaggedOnly?: boolean;
  }): Promise<IMachineAnomalyEvent[]> {
    const limit = args?.limit ?? 50;
    const flaggedOnly = args?.flaggedOnly ?? false;

    const result = flaggedOnly
      ? await db.execute(sql`
          SELECT
            id,
            observed_at,
            mode_key,
            score,
            flagged,
            warm,
            sample_count,
            top_contributors,
            created_at
          FROM machine_anomaly_events
          WHERE flagged = true
          ORDER BY observed_at DESC
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT
            id,
            observed_at,
            mode_key,
            score,
            flagged,
            warm,
            sample_count,
            top_contributors,
            created_at
          FROM machine_anomaly_events
          ORDER BY observed_at DESC
          LIMIT ${limit}
        `);

    return (result.rows as unknown as IEventRow[]).map(mapRow);
  }
}
