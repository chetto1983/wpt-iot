import { sql } from 'drizzle-orm';
import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { MachinePhase } from '@wpt/types';
import type { IMachineSnapshot, ICycleClosedEvent } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

// =============================================================================
// CONTEXT D-13 REFORMULATION (revision iteration 1, applied 2026-04-07)
// -----------------------------------------------------------------------------
// CONTEXT D-13 originally specified ABORTED as "machineStatus -> ABORTED without
// completedCycles increment". On code inspection, packages/types/src/enums.ts
// has no such enum value on MachineStatus -- the enum only carries the 9 PLC
// processing sub-stages (LOADING=0..DISCHARGE=8). The user approved an inline
// reformulation:
//
//   ABORTED = a cycle that started (we observed currentPhase transition into
//             AUTOMATIC_STARTED) AND ended (we observed currentPhase return to
//             STANDBY OR a >30s data gap inside an active window) WITHOUT
//             completedCycles having incremented during the window.
//
// Implementation:
//   - On cycle open (currentPhase: STANDBY -> AUTOMATIC_STARTED), snapshot
//     cycleStartCompletedCycles = snapshot.completedCycles, set inActiveCycle = true.
//   - On cycle close (currentPhase: AUTOMATIC_STARTED -> STANDBY OR >30s gap):
//       if completedCycles > cycleStartCompletedCycles -> emit normally (no hint)
//       if completedCycles === cycleStartCompletedCycles -> emit with hint: 'ABORTED'
//   - The classifier in Plan 07's classifyAttribution() honors the hint after
//     window-quality checks (TOO_SHORT, DATA_GAP) pass.
//
// Real PLC behavior must be confirmed at bench day per Plan 01
// ENERGY_VERIFICATION_GATE -- the simulator drives currentPhase transitions in
// cycleEngine.ts; the real AC500 PLC firmware behavior is the bench-day gate.
// =============================================================================

/** Debounce threshold: if no snapshot arrives for this long inside an active
 *  cycle window, treat it as an implicit cycle-end signal. 30s = 2x the normal
 *  15s snapshot cadence. */
const CYCLE_END_GAP_MS = 30_000;

/**
 * Real-time cycle boundary detector (ENRG-02 + ENRG-04 + D-13 ABORTED hint).
 *
 * Subscribes to `dataHub.onMachineData` and runs an FSM watching:
 *   - currentPhase transitions (STANDBY <-> AUTOMATIC_STARTED) -> cycle open/close
 *   - >30s gap inside an active window -> debounced cycle close
 *   - completedCycles decrement -> counter reset (PLC reboot / state wipe)
 *
 * Emits `cycle:closed` ICycleClosedEvent on every cycle close, with optional
 * `attributionStatusHint: 'ABORTED'` if completedCycles did NOT increment during
 * the active window.
 *
 * Pattern mirrors `wpt-iot/apps/backend/src/persistence/machineStore.ts:17-33`.
 * Holds closure-held state -- NOT a class, NOT a module-level singleton outside
 * the closure captured here. Plan 19-06 registers this from the energy route
 * plugin body as the start-function pattern prescribed by RESEARCH.md.
 */
export function startCycleTracker(log: IStoreLogger): void {
  // Closure-held FSM state -- the ONLY source of truth for the in-flight cycle
  let lastCompletedCycles: number | null = null;
  let lastCurrentPhase: number | null = null;
  let lastSnapshotTs: Date | null = null;
  let resetEpoch = 0;
  let inActiveCycle = false;
  let currentCycleStartTs: Date | null = null;
  let cycleStartCompletedCycles: number | null = null;
  let cycleSelectedCycleType = 0;
  let cycleLastMachineStatus = 0;

  // Seed the resetEpoch from the latest cycle_resets row on startup so a backend
  // restart does NOT restart the epoch count at 0 (per ENRG-04 -- composite cycle
  // ID must remain stable across restarts). Fire-and-forget: if the DB is not
  // reachable yet, we log and continue with resetEpoch=0.
  void (async () => {
    try {
      const rows = await db.execute(sql`
        SELECT reset_epoch AS "resetEpoch"
        FROM cycle_resets
        ORDER BY reset_epoch DESC
        LIMIT 1
      `);
      if (rows.rows.length > 0) {
        resetEpoch = Number((rows.rows[0] as { resetEpoch: number }).resetEpoch);
        log.info(
          { name: 'CycleTracker', resetEpoch },
          'CycleTracker resumed resetEpoch from DB',
        );
      }
    } catch (err) {
      log.error(
        { name: 'CycleTracker', err: (err as Error).message },
        'Failed to load resetEpoch from cycle_resets',
      );
    }
  })();

  /**
   * Emit a cycle:closed event for the currently active window and reset state.
   * Snapshot is the closing snapshot (the one that triggered the close -- either
   * the STANDBY transition or the post-gap snapshot).
   */
  function emitCycleClose(endedAt: Date, snapshot: IMachineSnapshot): void {
    if (
      !inActiveCycle ||
      currentCycleStartTs === null ||
      cycleStartCompletedCycles === null
    ) {
      return;
    }
    const incremented = snapshot.completedCycles > cycleStartCompletedCycles;
    const event: ICycleClosedEvent = {
      cycleNumber: incremented ? snapshot.completedCycles : cycleStartCompletedCycles + 1,
      resetEpoch,
      startedAt: currentCycleStartTs,
      endedAt,
      cycleType: cycleSelectedCycleType,
      machineStatus: cycleLastMachineStatus,
    };
    if (!incremented) {
      // D-13 reformulation: no completedCycles increment during the active
      // window -> ABORTED. Hint is honored by Plan 07 classifyAttribution()
      // after TOO_SHORT / DATA_GAP precedence checks.
      event.attributionStatusHint = 'ABORTED';
    }
    dataHub.emitCycleClosed(event);
    log.info(
      {
        name: 'CycleTracker',
        cycleNumber: event.cycleNumber,
        resetEpoch,
        durationSec: (endedAt.getTime() - currentCycleStartTs.getTime()) / 1000,
        hint: event.attributionStatusHint ?? null,
      },
      'Cycle closed',
    );
    // Reset window state
    inActiveCycle = false;
    currentCycleStartTs = null;
    cycleStartCompletedCycles = null;
  }

  dataHub.onMachineData((snapshot: IMachineSnapshot, timestamp: Date) => {
    try {
      // --- 1. Counter-reset detection (ENRG-04) -----------------------------
      if (
        lastCompletedCycles !== null &&
        snapshot.completedCycles < lastCompletedCycles
      ) {
        const before = lastCompletedCycles;
        const after = snapshot.completedCycles;
        resetEpoch += 1;
        log.info(
          {
            name: 'CycleTracker',
            resetEpoch,
            before,
            after,
            observedAt: timestamp.toISOString(),
          },
          'Counter reset detected -- incrementing resetEpoch',
        );
        // Fire-and-forget INSERT (do not block the event loop on DB write).
        void db
          .execute(
            sql`
              INSERT INTO cycle_resets (reset_epoch, observed_at, last_completed_cycles_before, new_completed_cycles_after)
              VALUES (${resetEpoch}, ${timestamp.toISOString()}::timestamptz, ${before}, ${after})
            `,
          )
          .catch((err: unknown) => {
            log.error(
              { name: 'CycleTracker', err: (err as Error).message },
              'Failed to INSERT cycle_resets',
            );
          });
        // Reset wipes any in-flight cycle window -- do NOT emit a hint, the
        // window is no longer trustworthy. Just reset state.
        inActiveCycle = false;
        currentCycleStartTs = null;
        cycleStartCompletedCycles = null;
        lastCompletedCycles = snapshot.completedCycles;
        lastCurrentPhase = snapshot.currentPhase;
        lastSnapshotTs = timestamp;
        return;
      }

      // --- 2. Debounced data-gap close (>30s since last snapshot, active cycle) ---
      if (
        inActiveCycle &&
        lastSnapshotTs !== null &&
        timestamp.getTime() - lastSnapshotTs.getTime() > CYCLE_END_GAP_MS
      ) {
        log.info(
          {
            name: 'CycleTracker',
            gapMs: timestamp.getTime() - lastSnapshotTs.getTime(),
          },
          'Data gap >30s in active cycle -- closing window',
        );
        // Use the previous snapshot's timestamp as the cycle end (not the new one
        // that arrived after the gap).
        emitCycleClose(lastSnapshotTs, snapshot);
        // Fall through to evaluate the new snapshot as a potential new cycle open.
      }

      // --- 3. Cycle window open: STANDBY -> AUTOMATIC_STARTED ---------------
      if (
        !inActiveCycle &&
        lastCurrentPhase !== null &&
        lastCurrentPhase !== MachinePhase.AUTOMATIC_STARTED &&
        snapshot.currentPhase === MachinePhase.AUTOMATIC_STARTED
      ) {
        inActiveCycle = true;
        currentCycleStartTs = timestamp;
        cycleStartCompletedCycles = snapshot.completedCycles;
        cycleSelectedCycleType = snapshot.selectedCycle;
        cycleLastMachineStatus = snapshot.machineStatus;
        log.info(
          {
            name: 'CycleTracker',
            cycleStartCompletedCycles,
            cycleType: cycleSelectedCycleType,
            startedAt: timestamp.toISOString(),
          },
          'Cycle window opened',
        );
      }

      // --- 4. Cycle window close: AUTOMATIC_STARTED -> STANDBY --------------
      if (
        inActiveCycle &&
        lastCurrentPhase === MachinePhase.AUTOMATIC_STARTED &&
        snapshot.currentPhase === MachinePhase.STANDBY
      ) {
        cycleLastMachineStatus = snapshot.machineStatus;
        emitCycleClose(timestamp, snapshot);
      }

      // --- 5. Update tracked state ------------------------------------------
      // Track the latest machineStatus inside an active cycle so emitCycleClose
      // can include it in the event payload.
      if (inActiveCycle) {
        cycleLastMachineStatus = snapshot.machineStatus;
      }
      lastCompletedCycles = snapshot.completedCycles;
      lastCurrentPhase = snapshot.currentPhase;
      lastSnapshotTs = timestamp;
    } catch (err) {
      log.error(
        { name: 'CycleTracker', err: (err as Error).message },
        'Cycle tracker error',
      );
    }
  });

  log.info({ name: 'CycleTracker', resetEpoch }, 'Cycle tracker started');
}
