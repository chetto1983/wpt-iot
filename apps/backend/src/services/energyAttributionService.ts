import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { ICycleClosedEvent } from '@wpt/types';
import { AttributionStatus } from '@wpt/types';

// =============================================================================
// CONTEXT D-13 REFORMULATION (revision iteration 1, applied 2026-04-07)
// -----------------------------------------------------------------------------
// CONTEXT D-13 originally specified ABORTED as "machineStatus -> ABORTED without
// completedCycles increment". The enum has no such value on MachineStatus --
// only the 9 PLC processing sub-stages (LOADING=0..DISCHARGE=8). The user
// approved an inline reformulation: cycleTracker (Plan 05) detects aborted
// windows by observing currentPhase transitions
// (STANDBY -> AUTOMATIC_STARTED -> STANDBY) without a completedCycles
// increment and sets attributionStatusHint: 'ABORTED' on the event payload.
// This file's stub classifier (Plan 06) honors the hint; Plan 07 extracts the
// full classifyAttribution() helper with TOO_SHORT/DATA_GAP precedence.
// See Plan 01/05/07 Note blocks for the full deviation history.
// =============================================================================

/** Result shape of the RESEARCH.md Pattern 5 window query. */
interface IWindowResult {
  kwh_delta: number | null;
  sample_count: number;
  max_gap_seconds: number | null;
  material_input_kg: number | null;
  material_output_kg: number | null;
  avg_rms_current: number | null;
}

/** Minimal logger interface compatible with Pino / Fastify logger. */
interface IServiceLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * EnergyAttributionService -- read window kWh delta from machine_snapshots,
 * insert cycle_records rows, run idempotent 5-minute backfill.
 *
 * ENRG-02 (per-cycle records), ENRG-03 (idempotent backfill), ENRG-05
 * (data-gap detection via max_gap_seconds). Attribution classification (the
 * 5 status branches) lives in Plan 07's full classifyAttribution() helper
 * that will replace this file's stub classifier. For Plan 06 the inline
 * stub is hint-aware (see D-13 reformulation comment block above).
 *
 * Static-only service -- zero ambient clock reads, zero instance state.
 * `detectAndPersistClosedCycles({ since })` takes the window anchor as an
 * explicit parameter; the Fastify route plugin scheduler in
 * apps/backend/src/routes/energy.ts provides it.
 */
export class EnergyAttributionService {
  /**
   * Compute the kWh delta over a closed-half-open window
   * [startedAt, endedAt) from machine_snapshots, plus sample count and
   * max consecutive gap in seconds. Also returns the final material
   * input/output weights and the average rms current over the window for
   * cycle_records columns.
   *
   * Implements RESEARCH.md "Pattern 5 -- window-query cycle attribution".
   */
  static async windowKwhDelta(
    startedAt: Date,
    endedAt: Date,
  ): Promise<IWindowResult> {
    const rows = await db.execute(sql`
      WITH w AS (
        SELECT
          energy_consumption,
          material_input_weight,
          material_output_weight,
          rms_curr_l1, rms_curr_l2, rms_curr_l3,
          timestamp,
          LAG(timestamp) OVER (ORDER BY timestamp) AS prev_ts
        FROM machine_snapshots
        WHERE timestamp >= ${startedAt}::timestamptz
          AND timestamp <  ${endedAt}::timestamptz
        ORDER BY timestamp
      )
      SELECT
        (
          (SELECT energy_consumption FROM w ORDER BY timestamp DESC LIMIT 1)
          -
          (SELECT energy_consumption FROM w ORDER BY timestamp ASC  LIMIT 1)
        ) AS kwh_delta,
        (SELECT COUNT(*) FROM w) AS sample_count,
        (SELECT MAX(EXTRACT(EPOCH FROM (timestamp - prev_ts))) FROM w WHERE prev_ts IS NOT NULL) AS max_gap_seconds,
        (SELECT material_input_weight  FROM w ORDER BY timestamp DESC LIMIT 1) AS material_input_kg,
        (SELECT material_output_weight FROM w ORDER BY timestamp DESC LIMIT 1) AS material_output_kg,
        (SELECT AVG((rms_curr_l1 + rms_curr_l2 + rms_curr_l3) / 3.0) FROM w) AS avg_rms_current
    `);
    const r = (rows.rows[0] ?? {}) as Record<string, unknown>;
    return {
      kwh_delta: r.kwh_delta == null ? null : Number(r.kwh_delta),
      sample_count: Number(r.sample_count ?? 0),
      max_gap_seconds:
        r.max_gap_seconds == null ? null : Number(r.max_gap_seconds),
      material_input_kg:
        r.material_input_kg == null ? null : Number(r.material_input_kg),
      material_output_kg:
        r.material_output_kg == null ? null : Number(r.material_output_kg),
      avg_rms_current:
        r.avg_rms_current == null ? null : Number(r.avg_rms_current),
    };
  }

  /**
   * Pure classifier -- derives AttributionStatus from a window result + event.
   * Per CONTEXT D-13 (reformulated -- see comment block at the top of this file):
   *   TOO_SHORT  : sample_count < 5  (precedence: takes priority over hint;
   *                if the window is too short we cannot trust ANY signal,
   *                including the abort hint)
   *   DATA_GAP   : max_gap_seconds > 60  (also takes priority over hint)
   *   ABORTED    : event.attributionStatusHint === 'ABORTED' (set by Plan 05
   *                cycleTracker FSM when a window opened+closed without a
   *                completedCycles increment)
   *   ATTRIBUTED : happy path (kwh_delta >= 0 and >= 5 samples and <= 60s max gap)
   *   UNKNOWN    : catch-all (includes negative kwh_delta -- Plan 09 reset-split
   *                deferred to v1.2 per Plan 12 KNOWN_ISSUES)
   *
   * Pure -- no I/O, no state. The trust boundary is the input contract.
   * insertCycleFromEvent delegates to this helper after running windowKwhDelta.
   * The ENRG-09 kwh_per_kg null guard lives OUTSIDE this classifier and is
   * applied in insertCycleFromEvent after the status is decided.
   */
  static classifyAttribution(
    window: {
      sample_count: number;
      max_gap_seconds: number | null;
      kwh_delta: number | null;
    },
    event: { attributionStatusHint?: 'ABORTED' },
  ): AttributionStatus {
    // Window-quality checks take precedence -- an unreliable window cannot
    // trust ANY higher-level signal, including the abort hint. A short or
    // gappy window with a hint set is a TOO_SHORT / DATA_GAP, NOT an ABORTED.
    if (window.sample_count < 5) return AttributionStatus.TOO_SHORT;
    if ((window.max_gap_seconds ?? 0) > 60) return AttributionStatus.DATA_GAP;
    // Window is reliable -- honor the abort hint if the tracker set one.
    if (event.attributionStatusHint === 'ABORTED') {
      return AttributionStatus.ABORTED;
    }
    // Negative or null delta -> UNKNOWN catch-all (typically reset-in-window;
    // per-bucket reset split deferred to v1.2 per Plan 12 KNOWN_ISSUES).
    if (window.kwh_delta == null || window.kwh_delta < 0) {
      return AttributionStatus.UNKNOWN;
    }
    return AttributionStatus.ATTRIBUTED;
  }

  /**
   * Insert one row into cycle_records for the given cycle event. Uses the
   * window-query helper to compute the kWh delta, material weights, and
   * average rms current. Status classification is delegated to
   * classifyAttribution() above (Plan 07); the ENRG-09 kwh_per_kg null guard
   * lives in this method after the classifier returns.
   *
   * Idempotency (ENRG-03): skip insert if a row with the same
   * (reset_epoch, cycle_number) already exists. Called by both the
   * cycle:closed subscriber (cyclePersister.ts) and the 5-minute backfill
   * scan; both paths MUST be safe to re-run.
   *
   * Returns `true` if a row was inserted, `false` if the idempotency check
   * found an existing row.
   */
  static async insertCycleFromEvent(
    event: ICycleClosedEvent,
    log: IServiceLogger,
  ): Promise<boolean> {
    // Idempotency check -- composite natural key (reset_epoch, cycle_number)
    // per ENRG-04. If a row already exists for this cycle, do NOT insert
    // again; the backfill and live path can race and we must not duplicate.
    const existing = await db.execute(sql`
      SELECT id FROM cycle_records
      WHERE reset_epoch = ${event.resetEpoch}
        AND cycle_number = ${event.cycleNumber}
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      return false;
    }

    const window = await EnergyAttributionService.windowKwhDelta(
      event.startedAt,
      event.endedAt,
    );
    const durationSeconds = Math.round(
      (event.endedAt.getTime() - event.startedAt.getTime()) / 1000,
    );

    // Plan 07: delegate status classification to the pure helper above.
    // Precedence: TOO_SHORT > DATA_GAP > hint > kwh_delta sign check > happy.
    const status = EnergyAttributionService.classifyAttribution(window, event);

    // ENRG-09: kwh_per_kg is NULL when material weights are 0.
    // NEVER Infinity, NEVER NaN. Belt-and-braces Number.isFinite() check.
    let kwhPerKg: number | null = null;
    const denominatorKg =
      window.material_output_kg && window.material_output_kg > 0
        ? window.material_output_kg
        : window.material_input_kg && window.material_input_kg > 0
          ? window.material_input_kg
          : null;
    if (
      denominatorKg != null &&
      window.kwh_delta != null &&
      window.kwh_delta >= 0
    ) {
      const candidate = window.kwh_delta / denominatorKg;
      if (Number.isFinite(candidate)) {
        kwhPerKg = candidate;
      }
    }

    await db.execute(sql`
      INSERT INTO cycle_records (
        reset_epoch, cycle_number,
        started_at, ended_at,
        cycle_type, duration_seconds,
        material_input_kg, material_output_kg,
        energy_kwh, avg_rms_current,
        kwh_per_kg, attribution_status
      ) VALUES (
        ${event.resetEpoch}, ${event.cycleNumber},
        ${event.startedAt}::timestamptz, ${event.endedAt}::timestamptz,
        ${event.cycleType}, ${durationSeconds},
        ${window.material_input_kg}, ${window.material_output_kg},
        ${window.kwh_delta}, ${window.avg_rms_current},
        ${kwhPerKg}, ${status}
      )
    `);
    log.info(
      {
        name: 'EnergyAttribution',
        cycleNumber: event.cycleNumber,
        resetEpoch: event.resetEpoch,
        status,
        kwhDelta: window.kwh_delta,
        sampleCount: window.sample_count,
        maxGapSeconds: window.max_gap_seconds,
        hint: event.attributionStatusHint ?? null,
      },
      'Cycle record persisted',
    );
    return true;
  }

  /**
   * Idempotent backfill: scan machine_snapshots for completedCycles
   * increments since `since` whose corresponding cycle_records row is
   * missing, and persist them. Called every 5 minutes from the Fastify
   * route plugin scheduler in apps/backend/src/routes/energy.ts.
   *
   * Heuristic: find every snapshot where completed_cycles increased
   * relative to the previous snapshot. The "started at" is the previous
   * snapshot, the "ended at" is the increment snapshot. Resolve resetEpoch
   * by joining to the most recent cycle_resets row whose observed_at <= the
   * increment timestamp (or 0 if none).
   *
   * Backfill does NOT set attributionStatusHint -- it can only detect
   * completedCycles-increment cycles (the happy path). Aborted cycles are
   * detected only by the real-time cycleTracker FSM which has access to
   * the full currentPhase transition history. This is accepted per
   * T-19-17b: the backfill is a safety net for missed happy-path cycles
   * after a backend restart, not a replacement for live tracking.
   *
   * ENRG-03: re-running this over the same window MUST NOT duplicate rows.
   * The idempotency guarantee comes from insertCycleFromEvent's existence
   * check on (reset_epoch, cycle_number).
   *
   * Returns the count of rows actually inserted.
   */
  static async detectAndPersistClosedCycles(
    opts: { since: Date },
    log: IServiceLogger,
  ): Promise<number> {
    // 1. Find candidate cycle boundaries -- snapshots where completed_cycles
    //    incremented vs the prior snapshot. Window-bounded by `since` so the
    //    scan is cheap (T-19-15 mitigation).
    const candidates = await db.execute(sql`
      WITH ordered AS (
        SELECT
          timestamp,
          completed_cycles,
          machine_status,
          selected_cycle,
          LAG(completed_cycles) OVER (ORDER BY timestamp) AS prev_completed,
          LAG(timestamp)        OVER (ORDER BY timestamp) AS prev_ts
        FROM machine_snapshots
        WHERE timestamp >= ${opts.since}::timestamptz
        ORDER BY timestamp
      )
      SELECT
        timestamp        AS "endedAt",
        prev_ts          AS "startedAt",
        completed_cycles AS "cycleNumber",
        machine_status   AS "machineStatus",
        selected_cycle   AS "cycleType"
      FROM ordered
      WHERE prev_completed IS NOT NULL
        AND completed_cycles IS NOT NULL
        AND completed_cycles > prev_completed
    `);

    let inserted = 0;
    for (const raw of candidates.rows as Array<{
      endedAt: Date | string;
      startedAt: Date | string | null;
      cycleNumber: number | string;
      machineStatus: number | string;
      cycleType: number | string;
    }>) {
      if (raw.startedAt == null) continue; // first-ever snapshot has no prev_ts

      const endedAt =
        raw.endedAt instanceof Date ? raw.endedAt : new Date(raw.endedAt);
      const startedAt =
        raw.startedAt instanceof Date
          ? raw.startedAt
          : new Date(raw.startedAt);

      // 2. Resolve resetEpoch -- most recent cycle_resets row whose
      //    observed_at <= endedAt; default 0 if none exist yet.
      const resetRow = await db.execute(sql`
        SELECT reset_epoch AS "resetEpoch"
        FROM cycle_resets
        WHERE observed_at <= ${endedAt}::timestamptz
        ORDER BY observed_at DESC
        LIMIT 1
      `);
      const resetEpoch =
        resetRow.rows.length > 0
          ? Number((resetRow.rows[0] as { resetEpoch: number }).resetEpoch)
          : 0;

      // 3. Delegate to the shared insertCycleFromEvent path so the
      //    idempotency check, window query, and classifier live in one
      //    place. No attributionStatusHint -- backfill cannot observe it.
      const wasInserted = await EnergyAttributionService.insertCycleFromEvent(
        {
          cycleNumber: Number(raw.cycleNumber),
          resetEpoch,
          startedAt,
          endedAt,
          cycleType: Number(raw.cycleType),
          machineStatus: Number(raw.machineStatus),
          // Phase 24: V03 cycle register fields (null for backfilled legacy cycles)
          cycleStatusLabel: 'UNKNOWN',
          startEnergyKwh: null,
          endEnergyKwh: null,
          startWaterL: null,
          endWaterL: null,
          containers: null,
          operator: null,
          orderNumber: null,
          grossInputKg: null,
          materialInputKg: null,
          energyKwh: null,
          waterL: null,
        },
        log,
      );
      if (wasInserted) inserted += 1;
    }

    log.info(
      {
        name: 'EnergyAttribution',
        backfilledCount: inserted,
        candidatesScanned: candidates.rows.length,
        since: opts.since.toISOString(),
      },
      'Backfill scan complete',
    );
    return inserted;
  }

  /**
   * No-op delegate -- Phase 19 schema is created by
   * EnergyConfigService.ensureTable() (Plan 04) which owns cycle_records
   * and cycle_resets. This method exists for API symmetry and future-
   * proofing if Phase 20+ adds attribution-specific tables.
   */
  static async ensureSchema(): Promise<void> {
    // Tables created by EnergyConfigService.ensureTable() -- see Plan 04.
  }

  /**
   * Sum the `material_output_kg` and count of cycles with
   * `attribution_status = 'ATTRIBUTED'` in the half-open window `[from, to)`.
   *
   * Phase 20 ENBL-04 EnPI denominator source. Aborted / gap / too-short
   * cycles are excluded by the status filter (belt) and by the
   * `material_output_kg > 0` filter (suspender) — so division by zero
   * in the ENPI calculation is impossible for any ATTRIBUTED row.
   *
   * @param args.from inclusive lower bound (started_at >= from)
   * @param args.to   exclusive upper bound (started_at <  to)
   * @returns `{ totalKg, totalCycles }` — zeros when the window is empty
   */
  static async sumAttributedKgInWindow(args: {
    from: Date;
    to: Date;
  }): Promise<{ totalKg: number; totalCycles: number }> {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(material_output_kg), 0)::float8 AS total_kg,
        COUNT(*)::int AS total_cycles
      FROM cycle_records
      WHERE attribution_status = 'ATTRIBUTED'
        AND material_output_kg > 0
        AND started_at >= ${args.from.toISOString()}::timestamptz
        AND started_at <  ${args.to.toISOString()}::timestamptz
    `);
    const row = result.rows[0] as { total_kg: number; total_cycles: number } | undefined;
    return {
      totalKg: Number(row?.total_kg ?? 0),
      totalCycles: Number(row?.total_cycles ?? 0),
    };
  }
}
