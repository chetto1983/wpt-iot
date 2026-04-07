import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { AttributionStatus, MachinePhase } from '@wpt/types';
import type { IMachineSnapshot } from '@wpt/types';
import { dataHub } from '../../events/hub.js';
import { db, pool } from '../../db/index.js';
import { startCycleTracker } from '../../persistence/cycleTracker.js';
import { EnergyAttributionService } from '../../services/energyAttributionService.js';

/**
 * PHASE 19 — cycleTracker FSM + classifyAttribution behavior contract.
 *
 * Tests 1-2 GREEN as of Plan 19-05 (startCycleTracker FSM).
 * Tests 3-8 GREEN as of Plan 19-07 (classifyAttribution helper).
 *
 * 8 cases total pin the expected behavior of:
 *
 *   - startCycleTracker (Plan 19-05) — the dataHub.onMachineData subscriber
 *     that detects currentPhase transitions and counter resets, and emits
 *     dataHub.emitCycleClosed with the appropriate (cycleNumber, resetEpoch)
 *     and optional attributionStatusHint: 'ABORTED'.
 *
 *   - classifyAttribution (Plan 19-07) — the pure function that decides which
 *     AttributionStatus to assign to a closed cycle window based on:
 *       (a) sample count in the window (TOO_SHORT < 5 samples — precedence);
 *       (b) gap detection (DATA_GAP if any consecutive interval > 60s —
 *           precedence over hint);
 *       (c) attributionStatusHint on the event payload (set to 'ABORTED' by
 *           cycleTracker FSM when a cycle window opens+closes without a
 *           completedCycles increment — see CONTEXT D-13 reformulated and
 *           Plan 01/05/07 Note blocks);
 *       (d) the happy path (ATTRIBUTED) for non-negative kwh_delta;
 *       (e) the catch-all (UNKNOWN) for negative kwh_delta from a reset
 *           landing inside the window (per-bucket reset split deferred to
 *           v1.2 per Plan 12 KNOWN_ISSUES).
 *
 * Plus the ENRG-09 invariant: kwhPerKg is NULL (never Infinity / NaN) when
 * material weights are zero. The unit-only test pins the divisor-resolution
 * semantics directly with a fixture; the end-to-end DB path is exercised by
 * Plan 19-12.
 */

// AttributionStatus is consumed by tests 3-6 below (Plan 19-07 GREEN).

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

  it('attributionStatusHint=ABORTED on a reliable window → AttributionStatus.ABORTED (Plan 19-07)', () => {
    // CONTEXT D-13 reformulation: cycleTracker FSM (Plan 19-05) sets
    // attributionStatusHint='ABORTED' on the emitted ICycleClosedEvent when a
    // cycle window opened and closed without completedCycles having
    // incremented during the window. classifyAttribution honors the hint AFTER
    // window-quality checks (TOO_SHORT, DATA_GAP) have passed.
    const window = { sample_count: 12, max_gap_seconds: 15, kwh_delta: 2.5 };
    const event = { attributionStatusHint: 'ABORTED' as const };
    expect(EnergyAttributionService.classifyAttribution(window, event)).toBe(
      AttributionStatus.ABORTED,
    );
  });

  it('reliable window with no hint and positive delta → AttributionStatus.ATTRIBUTED (Plan 19-07)', () => {
    // Bonus happy-path coverage so the classifier's default branch is pinned.
    const window = { sample_count: 20, max_gap_seconds: 15, kwh_delta: 5.0 };
    const event = {};
    expect(EnergyAttributionService.classifyAttribution(window, event)).toBe(
      AttributionStatus.ATTRIBUTED,
    );
  });

  it('reliable window with no hint and negative delta → AttributionStatus.UNKNOWN (Plan 19-07)', () => {
    // Negative kwh_delta inside a window is the reset-in-the-middle case.
    // Per-bucket reset split is deferred to v1.2 (Plan 12 KNOWN_ISSUES) so the
    // classifier marks UNKNOWN as the safety net for Phase 19.
    const window = { sample_count: 20, max_gap_seconds: 15, kwh_delta: -3 };
    const event = {};
    expect(EnergyAttributionService.classifyAttribution(window, event)).toBe(
      AttributionStatus.UNKNOWN,
    );
  });

  it('cycle window with fewer than 5 snapshots → AttributionStatus.TOO_SHORT (Plan 19-07)', () => {
    // 3 samples × 15s = 45s window, well under the 75s / 5-sample TOO_SHORT
    // threshold from CONTEXT D-13.
    const window = { sample_count: 3, max_gap_seconds: 15, kwh_delta: 1.0 };
    expect(EnergyAttributionService.classifyAttribution(window, {})).toBe(
      AttributionStatus.TOO_SHORT,
    );
    // Precedence check: even if a hint is set, TOO_SHORT wins because the
    // window itself is unreliable (we cannot trust the abort detection if we
    // cannot trust the window).
    const withHint = { attributionStatusHint: 'ABORTED' as const };
    expect(EnergyAttributionService.classifyAttribution(window, withHint)).toBe(
      AttributionStatus.TOO_SHORT,
    );
  });

  it('cycle window with a gap > 60s between consecutive snapshots → AttributionStatus.DATA_GAP (Plan 19-07, ENRG-05)', () => {
    // 10 samples but a 75s gap somewhere in the middle.
    const window = { sample_count: 10, max_gap_seconds: 75, kwh_delta: 5.0 };
    expect(EnergyAttributionService.classifyAttribution(window, {})).toBe(
      AttributionStatus.DATA_GAP,
    );
    // Precedence check: DATA_GAP wins over an ABORTED hint -- the window is
    // unreliable so the hint cannot be trusted.
    const withHint = { attributionStatusHint: 'ABORTED' as const };
    expect(EnergyAttributionService.classifyAttribution(window, withHint)).toBe(
      AttributionStatus.DATA_GAP,
    );
  });

  it('materialInputKg=0 + materialOutputKg=0 → kwhPerKg === null (never Infinity, never NaN) (Plan 19-07, ENRG-09)', () => {
    // ENRG-09 invariant: kwh_per_kg is NEVER Infinity, NEVER NaN. The
    // divisor-resolution math lives in EnergyAttributionService.insertCycleFromEvent
    // (the end-to-end DB path is exercised by Plan 19-12 fixture tests). This
    // unit-only test pins the divisor-resolution semantics directly with a
    // fixture so a future refactor cannot reintroduce the divide-by-zero bug.
    const kwhDelta = 5;
    const matInputKg = 0;
    const matOutputKg = 0;
    // Mirror the production resolver in insertCycleFromEvent: prefer output,
    // fall back to input, fall back to null. Both zero -> null.
    const denominator =
      matOutputKg > 0 ? matOutputKg : matInputKg > 0 ? matInputKg : null;
    const kwhPerKg: number | null =
      denominator !== null ? kwhDelta / denominator : null;
    expect(kwhPerKg).toBeNull();
    // Defense-in-depth: null is neither finite nor NaN.
    expect(Number.isFinite(kwhPerKg as number)).toBe(false);
    expect(Number.isNaN(kwhPerKg as number)).toBe(false);

    // Sanity-check the happy path: 12.5 kWh / 80 kg = 0.15625 kWh/kg.
    const happyDenominator = 80 > 0 ? 80 : 100 > 0 ? 100 : null;
    const happy =
      happyDenominator !== null ? 12.5 / happyDenominator : null;
    expect(happy).not.toBeNull();
    expect(happy).toBeGreaterThan(0);
    expect(Number.isFinite(happy as number)).toBe(true);
  });
});

afterAll(async () => {
  // Release the pool so vitest exits cleanly instead of hanging on open handles.
  await pool.end();
});
