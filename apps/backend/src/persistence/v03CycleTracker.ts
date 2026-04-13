import { sql } from 'drizzle-orm';
import { dataHub } from '../events/hub.js';
import { db } from '../db/index.js';
import { CycleStatus, CycleStatusLabel } from '@wpt/types';
import type { IMachineSnapshot, ICycleClosedEvent } from '@wpt/types';

/** Logger interface compatible with Pino/Fastify logger */
interface IStoreLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn?(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** In-flight cycle state holding start-side counters */
interface IInFlightCycle {
  startAt: Date;
  startEnergyKwh: number | null;
  startWaterL: number | null;
  operator: string;
  orderNumber: string;
  cycleNumber: number;
  containers: number;
  materialInputKg: number;
  grossInputKg: number;
}

/** Stuck cycle threshold: 24 hours in milliseconds */
const STUCK_CYCLE_MS = 24 * 60 * 60 * 1000;

/**
 * V03 Cycle_Status edge detection FSM (Phase 24 Wave 1).
 *
 * Subscribes to `dataHub.onMachineData` and watches Cycle_Status (S1_I_DATO_71)
 * for rising edge transitions:
 *   - 0 -> 1 (NONE -> CYCLE_START): Capture start snapshot
 *   - 1 -> {2,3,4} (CYCLE_START -> COMPLETED/FAILED/ABORTED): Emit cycle closed
 *
 * Replaces the old currentPhase-based FSM from cycleTracker.ts.
 */
export function startV03CycleTracker(log: IStoreLogger): void {
  // Closure-held FSM state
  let lastCompletedCycles: number | null = null;
  let lastCycleStatus: CycleStatus | null = null;
  let resetEpoch = 0;
  let inFlightCycle: IInFlightCycle | null = null;
  let warnedZeroStatus = false;

  // Seed the resetEpoch from the latest cycle_resets row on startup
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
          { name: 'V03CycleTracker', resetEpoch },
          'V03CycleTracker resumed resetEpoch from DB',
        );
      }
    } catch (err) {
      log.error(
        { name: 'V03CycleTracker', err: (err as Error).message },
        'Failed to load resetEpoch from cycle_resets',
      );
    }
  })();

  /**
   * Emit cycle:closed event and clear in-flight state
   */
  function emitCycleClose(
    endedAt: Date,
    snapshot: IMachineSnapshot,
    cycleStatus: CycleStatus,
  ): void {
    if (!inFlightCycle) {
      return;
    }

    const energyDelta =
      inFlightCycle.startEnergyKwh !== null && snapshot.energyConsumption !== null
        ? snapshot.energyConsumption - inFlightCycle.startEnergyKwh
        : null;

    const waterDelta =
      inFlightCycle.startWaterL !== null && snapshot.waterConsumption !== null
        ? snapshot.waterConsumption - inFlightCycle.startWaterL
        : null;

    const event: ICycleClosedEvent = {
      cycleNumber: inFlightCycle.cycleNumber,
      resetEpoch,
      startedAt: inFlightCycle.startAt,
      endedAt,
      cycleType: snapshot.selectedCycle,
      machineStatus: snapshot.machineStatus,
      cycleStatusLabel: CycleStatusLabel[cycleStatus] ?? 'UNKNOWN',
      startEnergyKwh: inFlightCycle.startEnergyKwh,
      endEnergyKwh: snapshot.energyConsumption,
      startWaterL: inFlightCycle.startWaterL,
      endWaterL: snapshot.waterConsumption,
      containers: inFlightCycle.containers,
      operator: inFlightCycle.operator || null,
      orderNumber: inFlightCycle.orderNumber || null,
      grossInputKg: inFlightCycle.grossInputKg,
      materialInputKg: inFlightCycle.materialInputKg,
      energyKwh: energyDelta,
      waterL: waterDelta,
    };

    // Add ABORTED hint for backward compatibility
    if (cycleStatus === CycleStatus.ABORTED) {
      event.attributionStatusHint = 'ABORTED';
    }

    dataHub.emitCycleClosed(event);
    log.info(
      {
        name: 'V03CycleTracker',
        cycleNumber: event.cycleNumber,
        resetEpoch,
        durationSec: (endedAt.getTime() - inFlightCycle.startAt.getTime()) / 1000,
        cycleStatusLabel: event.cycleStatusLabel,
      },
      'Cycle closed',
    );

    // Clear in-flight state
    inFlightCycle = null;
  }

  /**
   * Handle skipped start state (0 -> {2,3,4} directly)
   */
  function emitSkippedCycleClose(
    endedAt: Date,
    snapshot: IMachineSnapshot,
    cycleStatus: CycleStatus,
  ): void {
    const cycleNumber = snapshot.completedCycles;

    const event: ICycleClosedEvent = {
      cycleNumber,
      resetEpoch,
      startedAt: endedAt, // Use end time as start (unknown actual start)
      endedAt,
      cycleType: snapshot.selectedCycle,
      machineStatus: snapshot.machineStatus,
      cycleStatusLabel: CycleStatusLabel[cycleStatus] ?? 'UNKNOWN',
      startEnergyKwh: null,
      endEnergyKwh: snapshot.energyConsumption,
      startWaterL: null,
      endWaterL: snapshot.waterConsumption,
      containers: snapshot.container ?? null,
      operator: snapshot.user || null,
      orderNumber: snapshot.orderNumber || null,
      grossInputKg: snapshot.materialInputWeight ?? null,
      materialInputKg: snapshot.materialInputWeight ?? null,
      energyKwh: null,
      waterL: null,
      dataGap: true,
    };

    dataHub.emitCycleClosed(event);
    log.warn?.(
      {
        name: 'V03CycleTracker',
        cycleNumber,
        cycleStatusLabel: event.cycleStatusLabel,
      },
      'Skipped CYCLE_START state — emitting with NULL start counters',
    );
  }

  dataHub.onMachineData((snapshot: IMachineSnapshot, timestamp: Date) => {
    try {
      const currentStatus = snapshot.cycleStatus as CycleStatus;

      // Validate cycleStatus value
      if (currentStatus < 0 || currentStatus > 4) {
        log.warn?.(
          { name: 'V03CycleTracker', cycleStatus: currentStatus },
          `Unknown cycleStatus value: ${currentStatus}`,
        );
        // Still update last state but don't process edges for invalid values
        lastCompletedCycles = snapshot.completedCycles;
        lastCycleStatus = currentStatus;
        return;
      }

      // --- 0. WARN-on-zero: first snapshot with cycleStatus===0 ---
      if (
        !warnedZeroStatus &&
        currentStatus === CycleStatus.NONE &&
        lastCycleStatus === null
      ) {
        warnedZeroStatus = true;
        log.warn?.(
          { name: 'V03CycleTracker' },
          'V03 Cycle_Status is 0 — cycle tracking disabled until PLC sends lifecycle signals',
        );
      }

      // --- 1. Counter-reset detection (same as original cycleTracker) ---
      if (
        lastCompletedCycles !== null &&
        snapshot.completedCycles < lastCompletedCycles
      ) {
        const before = lastCompletedCycles;
        const after = snapshot.completedCycles;
        resetEpoch += 1;
        log.info(
          {
            name: 'V03CycleTracker',
            resetEpoch,
            before,
            after,
            observedAt: timestamp.toISOString(),
          },
          'Counter reset detected -- incrementing resetEpoch',
        );

        // Fire-and-forget INSERT
        void db
          .execute(
            sql`
              INSERT INTO cycle_resets (reset_epoch, observed_at, last_completed_cycles_before, new_completed_cycles_after)
              VALUES (${resetEpoch}, ${timestamp.toISOString()}::timestamptz, ${before}, ${after})
            `,
          )
          .catch((err: unknown) => {
            log.error(
              { name: 'V03CycleTracker', err: (err as Error).message },
              'Failed to INSERT cycle_resets',
            );
          });

        // Clear any in-flight cycle on counter reset
        if (inFlightCycle) {
          log.info(
            { name: 'V03CycleTracker', cycleNumber: inFlightCycle.cycleNumber },
            'Clearing in-flight cycle due to counter reset',
          );
          inFlightCycle = null;
        }

        lastCompletedCycles = snapshot.completedCycles;
        lastCycleStatus = currentStatus;
        return;
      }

      // --- 2. Detect stuck cycle (>24h in CYCLE_START) ---
      if (inFlightCycle && currentStatus === CycleStatus.CYCLE_START) {
        const elapsedMs = timestamp.getTime() - inFlightCycle.startAt.getTime();
        if (elapsedMs > STUCK_CYCLE_MS) {
          log.warn?.(
            {
              name: 'V03CycleTracker',
              cycleNumber: inFlightCycle.cycleNumber,
              elapsedHours: Math.round(elapsedMs / (60 * 60 * 1000)),
            },
            'Stuck cycle detected (>24h in CYCLE_START)',
          );
          // Do NOT auto-close — just warn
        }
      }

      // --- 3. Rising edge 0 -> 1: Cycle started ---
      if (
        lastCycleStatus === CycleStatus.NONE &&
        currentStatus === CycleStatus.CYCLE_START
      ) {
        inFlightCycle = {
          startAt: timestamp,
          startEnergyKwh: snapshot.energyConsumption ?? null,
          startWaterL: snapshot.waterConsumption ?? null,
          operator: snapshot.user ?? '',
          orderNumber: snapshot.orderNumber ?? '',
          cycleNumber: snapshot.completedCycles + 1,
          containers: snapshot.container ?? 0,
          materialInputKg: snapshot.materialInputWeight ?? 0,
          grossInputKg: snapshot.materialInputWeight ?? 0,
        };

        // Emit cycle start event
        dataHub.emitCycleStart({
          startEnergyKwh: inFlightCycle.startEnergyKwh,
          startWaterL: inFlightCycle.startWaterL,
          operator: inFlightCycle.operator,
          orderNumber: inFlightCycle.orderNumber,
          containers: inFlightCycle.containers,
          cycleNumber: inFlightCycle.cycleNumber,
          startedAt: timestamp,
        });

        log.info(
          {
            name: 'V03CycleTracker',
            cycleNumber: inFlightCycle.cycleNumber,
            startedAt: timestamp.toISOString(),
          },
          'Cycle started (0->1 edge)',
        );
      }

      // --- 4. Rising edge 1 -> {2,3,4}: Cycle ended ---
      if (
        lastCycleStatus === CycleStatus.CYCLE_START &&
        (currentStatus === CycleStatus.COMPLETED ||
          currentStatus === CycleStatus.FAILED ||
          currentStatus === CycleStatus.ABORTED)
      ) {
        if (inFlightCycle) {
          emitCycleClose(timestamp, snapshot, currentStatus);
        } else {
          // Edge case: cycle end without start (shouldn't happen with valid PLC)
          log.warn?.(
            { name: 'V03CycleTracker', cycleStatus: currentStatus },
            'Cycle end detected without in-flight cycle',
          );
        }
      }

      // --- 5. Skipped state: 0 -> {2,3,4} directly ---
      if (
        (lastCycleStatus === CycleStatus.NONE || lastCycleStatus === null) &&
        (currentStatus === CycleStatus.COMPLETED ||
          currentStatus === CycleStatus.FAILED ||
          currentStatus === CycleStatus.ABORTED)
      ) {
        log.warn?.(
          { name: 'V03CycleTracker', from: lastCycleStatus, to: currentStatus },
          'Skipped CYCLE_START state',
        );
        emitSkippedCycleClose(timestamp, snapshot, currentStatus);
      }

      // --- 6. Update tracked state ---
      lastCompletedCycles = snapshot.completedCycles;
      lastCycleStatus = currentStatus;
    } catch (err) {
      log.error(
        { name: 'V03CycleTracker', err: (err as Error).message },
        'V03CycleTracker error',
      );
    }
  });

  log.info({ name: 'V03CycleTracker', resetEpoch }, 'V03 cycle tracker started');
}
