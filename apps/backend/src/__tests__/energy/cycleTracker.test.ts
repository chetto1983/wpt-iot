import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { AttributionStatus, MachinePhase } from '@wpt/types';
import type { IMachineSnapshot } from '@wpt/types';
import { dataHub } from '../../events/hub.js';
import { db, pool } from '../../db/index.js';
import { startCycleTracker } from '../../persistence/cycleTracker.js';

/**
 * PHASE 19 — cycleTracker FSM + classifyAttribution behavior contract.
 *
 * Tests 1-2 GREEN as of Plan 19-05 (startCycleTracker FSM).
 * Tests 3-6 stay it.skip — they are enabled by Plan 19-07 (classifyAttribution
 * + computeKwhPerKg).
 *
 * 6 cases total pin the expected behavior of:
 *
 *   - startCycleTracker (Plan 19-05) — the dataHub.onMachineData subscriber
 *     that detects currentPhase transitions and counter resets, and emits
 *     dataHub.emitCycleClosed with the appropriate (cycleNumber, resetEpoch)
 *     and optional attributionStatusHint: 'ABORTED'.
 *
 *   - classifyAttribution (Plan 19-07) — the function that decides which
 *     AttributionStatus to assign to a closed cycle window based on:
 *       (a) attributionStatusHint on the event payload (set to 'ABORTED' by
 *           cycleTracker FSM when a cycle window opens+closes without a
 *           completedCycles increment — see CONTEXT D-13 reformulated and
 *           Plan 01/05/07 Note blocks);
 *       (b) sample count in the window (TOO_SHORT < 5 samples);
 *       (c) gap detection (DATA_GAP if any consecutive interval > 60s);
 *       (d) the happy path (ATTRIBUTED).
 *
 * Plus the ENRG-09 invariant: kwhPerKg is NULL (never Infinity / NaN) when
 * material weights are zero.
 *
 * The `AttributionStatus` import below is intentionally retained — it lets
 * the test file fail at COMPILE time if Plan 19-01's enum shape regresses,
 * even before any it.skip body is enabled.
 */

// Touch the import so noUnusedLocals does not strip it before Plan 19-07.
void AttributionStatus;

/** Build a minimal IMachineSnapshot fixture for the FSM tests. The tracker
 *  only reads 4 fields (completedCycles, currentPhase, machineStatus,
 *  selectedCycle) — the rest are unchecked filler. */
function snap(overrides: Partial<IMachineSnapshot>): IMachineSnapshot {
  return {
    completedCycles: 10,
    machineStatus: 1,
    currentPhase: MachinePhase.AUTOMATIC_STARTED,
    selectedCycle: 0,
    ...overrides,
  } as unknown as IMachineSnapshot;
}

describe('startCycleTracker — cycle window FSM (RED — Plan 19-05)', () => {
  beforeEach(() => {
    // dataHub is a module singleton; strip all listeners so each test runs
    // against a clean subscriber set.
    dataHub.removeAllListeners('machine:data');
    dataHub.removeAllListeners('cycle:closed');
    vi.clearAllMocks();
  });

  afterEach(() => {
    dataHub.removeAllListeners('machine:data');
    dataHub.removeAllListeners('cycle:closed');
  });

  it('emits cycle:closed exactly once when completedCycles increments (RED — Plan 19-05)', () => {
    const emitSpy = vi.spyOn(dataHub, 'emitCycleClosed');
    const log = { info: vi.fn(), error: vi.fn() };
    startCycleTracker(log);

    // Seed: STANDBY snapshot at completedCycles=10.
    dataHub.emitMachineData(
      snap({ completedCycles: 10, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T10:00:00Z'),
    );
    // Cycle open: AUTOMATIC_STARTED at completedCycles=10, machineStatus=LOADING.
    dataHub.emitMachineData(
      snap({ completedCycles: 10, currentPhase: MachinePhase.AUTOMATIC_STARTED, machineStatus: 0 }),
      new Date('2026-04-07T10:00:15Z'),
    );
    // Mid-cycle progression — completedCycles still 10, processing sub-stage advances.
    dataHub.emitMachineData(
      snap({ completedCycles: 10, currentPhase: MachinePhase.AUTOMATIC_STARTED, machineStatus: 4 }),
      new Date('2026-04-07T10:00:30Z'),
    );
    // Cycle increment landed — completedCycles=11, still AUTOMATIC_STARTED.
    dataHub.emitMachineData(
      snap({ completedCycles: 11, currentPhase: MachinePhase.AUTOMATIC_STARTED, machineStatus: 8 }),
      new Date('2026-04-07T10:00:45Z'),
    );
    // Cycle close: STANDBY at completedCycles=11.
    dataHub.emitMachineData(
      snap({ completedCycles: 11, currentPhase: MachinePhase.STANDBY, machineStatus: 8 }),
      new Date('2026-04-07T10:01:00Z'),
    );

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const payload = emitSpy.mock.calls[0]?.[0];
    expect(payload?.cycleNumber).toBe(11);
    expect(payload?.resetEpoch).toBe(0);
    expect(payload?.attributionStatusHint).toBeUndefined();
    expect(payload?.endedAt.toISOString()).toBe('2026-04-07T10:01:00.000Z');
    expect(payload?.startedAt.toISOString()).toBe('2026-04-07T10:00:15.000Z');
    expect(payload?.machineStatus).toBe(8);

    emitSpy.mockRestore();
  });

  it('counter decrease creates a new cycle_resets row and increments resetEpoch (RED — Plan 19-05)', async () => {
    // Ensure the cycle_resets table exists and is empty before the test runs.
    // Directly CREATE the table rather than calling EnergyConfigService.ensureTable()
    // because tariffPeriods.test.ts runs in parallel and DROPs a shared set of
    // tables CASCADE in its beforeEach — a full ensureTable() call races with
    // that DROP. A scoped `CREATE TABLE IF NOT EXISTS cycle_resets` does not.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cycle_resets (
        id SERIAL PRIMARY KEY,
        reset_epoch INTEGER NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        last_completed_cycles_before INTEGER NOT NULL,
        new_completed_cycles_after INTEGER NOT NULL
      )
    `);
    await db.execute(sql`DELETE FROM cycle_resets`);

    const log = { info: vi.fn(), error: vi.fn() };
    startCycleTracker(log);

    // 3 stable snapshots at completedCycles=10, STANDBY (not in an active window).
    dataHub.emitMachineData(
      snap({ completedCycles: 10, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T11:00:00Z'),
    );
    dataHub.emitMachineData(
      snap({ completedCycles: 10, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T11:00:15Z'),
    );
    dataHub.emitMachineData(
      snap({ completedCycles: 10, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T11:00:30Z'),
    );
    // RESET: completedCycles drops from 10 to 0 (PLC reboot / simulator wipe).
    dataHub.emitMachineData(
      snap({ completedCycles: 0, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T11:00:45Z'),
    );

    // Give the fire-and-forget INSERT a chance to land.
    await new Promise((r) => setTimeout(r, 200));

    const rows = await db.execute(sql`
      SELECT
        reset_epoch                   AS "resetEpoch",
        last_completed_cycles_before  AS "lastBefore",
        new_completed_cycles_after    AS "newAfter"
      FROM cycle_resets
      ORDER BY reset_epoch DESC
      LIMIT 1
    `);
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0] as {
      resetEpoch: number;
      lastBefore: number;
      newAfter: number;
    };
    expect(Number(row.resetEpoch)).toBe(1);
    expect(Number(row.lastBefore)).toBe(10);
    expect(Number(row.newAfter)).toBe(0);
  });

  it.skip('cycle window opened+closed without completedCycles increment → attributionStatusHint=ABORTED → AttributionStatus.ABORTED (RED — Plan 19-05 / Plan 19-07)', () => {
    /* BODY — enable in Plan 19-07:
    // CONTEXT D-13 reformulation: there is no MachineStatus.ABORTED enum value,
    // so cycleTracker FSM uses currentPhase transitions
    // (STANDBY → AUTOMATIC_STARTED → STANDBY) to bracket a window. If
    // completedCycles never incremented inside that window, the FSM sets
    // attributionStatusHint='ABORTED' on the emitted ICycleClosedEvent.
    // classifyAttribution then honors that hint AFTER checking TOO_SHORT and
    // DATA_GAP precedence.
    const emitSpy = vi.spyOn(dataHub, 'emitCycleClosed');
    const log = { info: vi.fn(), error: vi.fn() };
    startCycleTracker(log);

    // Seed STANDBY.
    dataHub.emitMachineData(
      snap({ completedCycles: 7, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T12:00:00Z'),
    );
    // Open cycle + 11 intermediate AUTOMATIC_STARTED snapshots, completedCycles never moves off 7.
    for (let i = 1; i < 12; i++) {
      dataHub.emitMachineData(
        snap({ completedCycles: 7, currentPhase: MachinePhase.AUTOMATIC_STARTED, machineStatus: 1 }),
        new Date(`2026-04-07T12:00:${String(i * 5).padStart(2, '0')}Z`),
      );
    }
    // Close cycle — still completedCycles=7.
    dataHub.emitMachineData(
      snap({ completedCycles: 7, currentPhase: MachinePhase.STANDBY, machineStatus: 0 }),
      new Date('2026-04-07T12:01:00Z'),
    );

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const payload = emitSpy.mock.calls[0]?.[0];
    expect(payload?.attributionStatusHint).toBe('ABORTED');

    // classifyAttribution should map the hint to AttributionStatus.ABORTED for
    // a window with sufficient samples and no gaps.
    const { classifyAttribution } = await import('../../services/energyAttributionService.js');
    const result = classifyAttribution({
      sampleCount: 12,
      maxGapSeconds: 15,
      attributionStatusHint: 'ABORTED',
    });
    expect(result).toBe(AttributionStatus.ABORTED);
    emitSpy.mockRestore();
    */
  });

  it.skip('cycle window with fewer than 5 snapshots → AttributionStatus.TOO_SHORT (RED — Plan 19-07)', () => {
    /* BODY — enable in Plan 19-07:
    const { classifyAttribution } = await import('../../services/energyAttributionService.js');
    // 3 samples × 15s = 45s window, well under the 75s/5-sample TOO_SHORT
    // threshold from CONTEXT D-13.
    const result = classifyAttribution({
      sampleCount: 3,
      maxGapSeconds: 15,
    });
    expect(result).toBe(AttributionStatus.TOO_SHORT);
    */
  });

  it.skip('cycle window with a gap > 60s between consecutive snapshots → AttributionStatus.DATA_GAP (RED — Plan 19-07, ENRG-05)', () => {
    /* BODY — enable in Plan 19-07:
    const { classifyAttribution } = await import('../../services/energyAttributionService.js');
    // 10 samples but a 75s gap somewhere in the middle.
    const result = classifyAttribution({
      sampleCount: 10,
      maxGapSeconds: 75,
    });
    expect(result).toBe(AttributionStatus.DATA_GAP);
    // Precedence check: DATA_GAP wins over an ABORTED hint.
    const withHint = classifyAttribution({
      sampleCount: 10,
      maxGapSeconds: 75,
      attributionStatusHint: 'ABORTED',
    });
    expect(withHint).toBe(AttributionStatus.DATA_GAP);
    */
  });

  it.skip('materialInputKg=0 + materialOutputKg=0 → kwhPerKg === null (never Infinity, never NaN) (RED — Plan 19-07, ENRG-09)', () => {
    /* BODY — enable in Plan 19-07:
    const { computeKwhPerKg } = await import('../../services/energyAttributionService.js');
    // Zero in, zero out — the divide-by-zero edge case ENRG-09 protects against.
    const result = computeKwhPerKg({
      energyKwh: 5,
      materialInputKg: 0,
      materialOutputKg: 0,
    });
    expect(result).toBeNull();
    // Defense-in-depth: the result must NEVER be Infinity or NaN.
    expect(Number.isFinite(result as number)).toBe(false); // null is not finite
    expect(Number.isNaN(result as number)).toBe(false);

    // Sanity-check the happy path while we are here.
    const happy = computeKwhPerKg({
      energyKwh: 12.5,
      materialInputKg: 100,
      materialOutputKg: 80,
    });
    expect(happy).not.toBeNull();
    expect(happy).toBeGreaterThan(0);
    */
  });
});

afterAll(async () => {
  // Release the pool so vitest exits cleanly instead of hanging on open handles.
  await pool.end();
});
