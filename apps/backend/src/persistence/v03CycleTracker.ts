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
 * for entry-edge transitions:
 *   - any non-1 -> 1: Capture start snapshot
 *   - entry into {2,3,4} with an open cycle: Emit cycle closed
 *
 * Replaces the old currentPhase-based FSM from cycleTracker.ts.
 */
export async function startV03CycleTracker(log: IStoreLogger): Promise<void> {
  // Closure-held FSM state
  let lastCompletedCycles: number | null = null;
  let lastCycleStatus: CycleStatus | null = null;
  let resetEpoch = 0;
  let inFlightCycle: IInFlightCycle | null = null;
  let warnedZeroStatus = false;
  // Max cycle_number persisted at current resetEpoch, loaded from DB on startup.
  // Used once on the first incoming snapshot to detect a PLC counter reset
  // that happened while the backend was DOWN (the live-reset branch at line ~209
  // only catches in-session resets). Cleared after the first check to avoid
  // double-detection on normal operation.
  let lastKnownMaxCycleNumber: number | null = null;

  // Complete bootstrap before registering the machine-data handler. The UDP
  // pipeline starts only after Fastify plugins are ready, so no edge can race
  // reset-epoch/open-cycle recovery.
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

    const maxRows = await db.execute(sql`
      SELECT MAX(cycle_number) AS "maxCycleNumber"
      FROM cycle_records
      WHERE reset_epoch = ${resetEpoch}
    `);
    if (maxRows.rows.length > 0) {
      const raw = (maxRows.rows[0] as { maxCycleNumber: number | string | null })
        .maxCycleNumber;
      if (raw !== null) {
        lastKnownMaxCycleNumber = Number(raw);
        log.info(
          { name: 'V03CycleTracker', resetEpoch, lastKnownMaxCycleNumber },
          'Loaded persisted max cycle_number for current epoch',
        );
      }
    }

    const openRows = await db.execute(sql`
      SELECT
        s.started_at AS "startAt",
        s.start_energy_kwh AS "startEnergyKwh",
        s.start_water_l AS "startWaterL",
        s.operator,
        s.order_number AS "orderNumber",
        s.cycle_number AS "cycleNumber",
        s.containers,
        s.material_input_kg AS "materialInputKg",
        s.gross_input_kg AS "grossInputKg"
      FROM cycle_starts s
      WHERE s.reset_epoch = ${resetEpoch}
        AND NOT EXISTS (
          SELECT 1
          FROM cycle_records r
          WHERE r.reset_epoch = s.reset_epoch
            AND r.cycle_number = s.cycle_number
            AND COALESCE(r.cycle_status_label, 'UNKNOWN') <> 'UNKNOWN'
        )
      ORDER BY s.started_at DESC
      LIMIT 1
    `);
    if (openRows.rows.length > 0) {
      const row = openRows.rows[0] as {
        startAt: Date | string;
        startEnergyKwh: number | string | null;
        startWaterL: number | string | null;
        operator: string;
        orderNumber: string;
        cycleNumber: number | string;
        containers: number | string;
        materialInputKg: number | string;
        grossInputKg: number | string;
      };
      inFlightCycle = {
        startAt: row.startAt instanceof Date ? row.startAt : new Date(row.startAt),
        startEnergyKwh:
          row.startEnergyKwh === null ? null : Number(row.startEnergyKwh),
        startWaterL: row.startWaterL === null ? null : Number(row.startWaterL),
        operator: row.operator,
        orderNumber: row.orderNumber,
        cycleNumber: Number(row.cycleNumber),
        containers: Number(row.containers),
        materialInputKg: Number(row.materialInputKg),
        grossInputKg: Number(row.grossInputKg),
      };
      log.info(
        {
          name: 'V03CycleTracker',
          resetEpoch,
          cycleNumber: inFlightCycle.cycleNumber,
          startedAt: inFlightCycle.startAt.toISOString(),
        },
        'Recovered open cycle start from DB',
      );
    }
  } catch (err) {
    log.error(
      { name: 'V03CycleTracker', err: (err as Error).message },
      'Failed to load resetEpoch/open cycle from DB',
    );
  }

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

      // --- 0b. Cross-restart counter-reset detection ---
      // On the first snapshot after backend restart, compare incoming
      // completedCycles against the max cycle_number we persisted at the
      // current resetEpoch. If the PLC counter went backward while the
      // backend was down (power cycle, firmware reset), bump resetEpoch
      // so downstream idempotency checks in insertCycleFromEvent won't
      // collide with existing rows.
      if (
        lastCompletedCycles === null &&
        lastKnownMaxCycleNumber !== null &&
        snapshot.completedCycles < lastKnownMaxCycleNumber
      ) {
        const before = lastKnownMaxCycleNumber;
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
          'Counter reset detected across backend restart -- incrementing resetEpoch',
        );
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
              'Failed to INSERT cycle_resets (cross-restart path)',
            );
          });
      }
      // Clear after first snapshot regardless, so this check runs only once.
      lastKnownMaxCycleNumber = null;

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

      const enteredStart =
        lastCycleStatus !== CycleStatus.CYCLE_START &&
        currentStatus === CycleStatus.CYCLE_START;
      const enteredTerminal =
        lastCycleStatus !== currentStatus &&
        (currentStatus === CycleStatus.COMPLETED ||
          currentStatus === CycleStatus.FAILED ||
          currentStatus === CycleStatus.ABORTED);

      // --- 3. Entry edge x -> 1: Cycle started ---
      // The PLC can begin the next cycle directly from a terminal state, so
      // requiring exactly 0 -> 1 loses every 2/3/4 -> 1 start.
      if (enteredStart) {
        const expectedCycleNumber = snapshot.completedCycles + 1;
        if (inFlightCycle && lastCycleStatus === null) {
          log.info(
            {
              name: 'V03CycleTracker',
              cycleNumber: inFlightCycle.cycleNumber,
              from: lastCycleStatus,
            },
            'Recovered cycle start confirmed by PLC state',
          );
        } else {
          if (inFlightCycle) {
            log.warn?.(
              {
                name: 'V03CycleTracker',
                previousCycleNumber: inFlightCycle.cycleNumber,
                cycleNumber: expectedCycleNumber,
              },
              'Replacing stale in-flight cycle on a new start edge',
            );
          }

          inFlightCycle = {
            startAt: timestamp,
            startEnergyKwh: snapshot.energyConsumption ?? null,
            startWaterL: snapshot.waterConsumption ?? null,
            operator: snapshot.user ?? '',
            orderNumber: snapshot.orderNumber ?? '',
            cycleNumber: expectedCycleNumber,
            containers: snapshot.container ?? 0,
            materialInputKg: snapshot.materialInputWeight ?? 0,
            grossInputKg: snapshot.materialInputWeight ?? 0,
          };

          dataHub.emitCycleStart({
            resetEpoch,
            startEnergyKwh: inFlightCycle.startEnergyKwh,
            startWaterL: inFlightCycle.startWaterL,
            operator: inFlightCycle.operator,
            orderNumber: inFlightCycle.orderNumber,
            containers: inFlightCycle.containers,
            materialInputKg: inFlightCycle.materialInputKg,
            grossInputKg: inFlightCycle.grossInputKg,
            cycleNumber: inFlightCycle.cycleNumber,
            startedAt: timestamp,
          });

          log.info(
            {
              name: 'V03CycleTracker',
              cycleNumber: inFlightCycle.cycleNumber,
              from: lastCycleStatus,
              startedAt: timestamp.toISOString(),
            },
            'Cycle started on entry edge to status 1',
          );
        }
      }

      // --- 4. Entry edge into {2,3,4}: Cycle ended ---
      if (enteredTerminal) {
        if (inFlightCycle) {
          emitCycleClose(timestamp, snapshot, currentStatus);
        } else if (
          lastCycleStatus === CycleStatus.CYCLE_START ||
          lastCycleStatus === CycleStatus.NONE
        ) {
          log.warn?.(
            { name: 'V03CycleTracker', cycleStatus: currentStatus },
            'Skipped CYCLE_START state — cycle end detected without in-flight cycle',
          );
          emitSkippedCycleClose(timestamp, snapshot, currentStatus);
        } else if (lastCycleStatus === null) {
          log.info(
            { name: 'V03CycleTracker', cycleStatus: currentStatus },
            'Initial terminal PLC state observed; waiting for a new start edge',
          );
        }
      }

      // --- 5. Update tracked state ---
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
