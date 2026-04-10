import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CycleStatus, CycleStatusLabel } from '@wpt/types';
import type { IMachineSnapshot, ICycleClosedEvent } from '@wpt/types';

/**
 * PHASE 24 Wave 0 — V03 Cycle_Status edge detection FSM test scaffold.
 *
 * These tests define the expected behavior for the V03 Cycle_Status (S1_I_DATO_71)
 * rising-edge detection FSM that replaces the current currentPhase-transition tracker.
 *
 * Per CONTEXT D-02: Watch cycleStatus for transitions:
 *   - 0→1: capture start snapshot (energy, water, operator, order, containers)
 *   - 1→{2,3,4}: emit ICycleClosedEvent with status label decoded
 *
 * Per SPEC cycle-register-export.md §Status enum:
 *   0=NONE, 1=CYCLE_START, 2=COMPLETED(OK), 3=FAILED, 4=ABORTED
 *
 * All tests currently FAIL (RED phase) — implementation in Wave 1.
 */

// ---------------------------------------------------------------------------
// Mock dataHub before importing SUT (hoisted)
// ---------------------------------------------------------------------------
const emitCycleClosed = vi.fn();
const emitCycleStart = vi.fn();

// Store the registered handler so tests can trigger it
let machineDataHandler: ((snapshot: IMachineSnapshot, timestamp: Date) => void) | null = null;

vi.mock('../../events/hub.js', () => ({
  dataHub: {
    emitCycleClosed,
    emitCycleStart,
    onMachineData: vi.fn((handler: (snapshot: IMachineSnapshot, timestamp: Date) => void) => {
      machineDataHandler = handler;
      return { on: vi.fn() };
    }),
  },
}));

// ---------------------------------------------------------------------------
// Test data factory for V03 machine snapshots
// ---------------------------------------------------------------------------
function makeSnapshot(overrides: Partial<IMachineSnapshot> = {}): IMachineSnapshot {
  return {
    // Core V03 fields for cycle tracking
    cycleStatus: CycleStatus.NONE,
    completedCycles: 10,
    currentPhase: 1, // STANDBY
    machineStatus: 0,
    selectedCycle: 3,
    materialInputWeight: 100,
    materialOutputWeight: 80,
    container: 13,
    energyConsumption: 1250.5,
    waterConsumption: 45.2,
    user: 'MARIO ROSSI',
    supervisor: 'SUPERVISOR1',
    orderNumber: 'ORD-2026-001',
    serialNumber: 'NW30-020',
    // Fillers for required fields
    thermoLeftLower: 0, thermoLeftMedium: 0, thermoLeftUpper: 0,
    thermoRightLower: 0, thermoRightMedium: 0, thermoRightUpper: 0,
    thermoLeftHighLower: 0, thermoLeftHighMedium: 0, thermoLeftHighUpper: 0,
    thermoRightHighLower: 0, garbageTemp: 0, holdingTempSetpoint: 0,
    chamberPressure: 0, mainMotorSpeed: 0, mainMotorTorque: 0,
    mainMotorCurrent: 0, vacuumPumpSpeed01: 0, vacuumPumpSpeed02: 0,
    spareInt19: 0, spareInt20: 0, spareInt21: 0, spareInt22: 0,
    spareInt23: 0, spareInt24: 0, spareInt25: 0, spareInt26: 0,
    spareInt27: 0, spareInt28: 0, spareInt29: 0, spareInt30: 0,
    spareInt31: 0, spareInt32: 0, spareInt33: 0, spareInt34: 0,
    spareInt35: 0, spareInt36: 0, spareInt37: 0, spareInt38: 0,
    spareInt39: 0, spareInt40: 0, spareInt41: 0, spareInt42: 0,
    spareInt43: 0, spareInt44: 0, spareInt45: 0, spareInt46: 0,
    spareInt47: 0, spareInt48: 0, spareInt49: 0, spareInt50: 0,
    spareInt51: 0, spareInt52: 0, spareInt53: 0, spareInt54: 0,
    spareInt55: 0, spareInt56: 0, spareInt62: 0, spareInt63: 0,
    spareInt64: 0, spareInt65: 0, spareInt66: 0, spareInt67: 0,
    spareInt68: 0, spareInt69: 0, spareInt70: 0,
    spareDint01: 0,
    spareString01: '',
    rmsCurrL1: 0, rmsCurrL2: 0, rmsCurrL3: 0, rmsCurrN: 0,
    spareReal01: 0,
    lineVoltL1L2: 400, lineVoltL2L3: 400, lineVoltL3L1: 400,
    lineNeutralVoltL1: 230, lineNeutralVoltL2: 230, lineNeutralVoltL3: 230,
    pfTotal: 0.85,
    spareReal02: 0,
    thermoLeftLowSel: 0, thermoLeftMedSel: 0, thermoLeftHighSel: 0,
    thermoRightLowSel: 0, thermoRightMedSel: 0, thermoRightHighSel: 0,
    ...overrides,
  } as unknown as IMachineSnapshot;
}

// Import SUT after mocks
const { startV03CycleTracker } = await import('../../persistence/v03CycleTracker.js');

describe('V03 Cycle_Status edge detection FSM (RED — Phase 24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: Rising edge 0→1 captures start snapshot
  // ==========================================================================
  it('Cycle_Status 0->1 edge detection triggers start snapshot capture', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // First: Establish initial state as NONE (0)
    const initialSnapshot = makeSnapshot({
      cycleStatus: CycleStatus.NONE,
      completedCycles: 10,
    });
    machineDataHandler!(initialSnapshot, new Date());

    // Then: Trigger 0->1 transition
    const startSnapshot = makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START, // 0->1 transition
      energyConsumption: 1250.5,
      waterConsumption: 45.2,
      user: 'MARIO ROSSI',
      orderNumber: 'ORD-2026-001',
      container: 13,
      completedCycles: 10,
    });
    machineDataHandler!(startSnapshot, new Date());

    // Expect: In-memory snapshot holds start counters
    expect(emitCycleStart).toHaveBeenCalledWith(expect.objectContaining({
      startEnergyKwh: 1250.5,
      startWaterL: 45.2,
      operator: 'MARIO ROSSI',
      orderNumber: 'ORD-2026-001',
      containers: 13,
    }));
  });

  // ==========================================================================
  // Test 2: Rising edge 1→2 emits COMPLETED cycle event
  // ==========================================================================
  it('Cycle_Status 1->2 edge detection emits COMPLETED cycle event', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Start cycle (0->1)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
      energyConsumption: 1250.5,
      waterConsumption: 45.2,
    }), new Date());

    // Step 3: Complete cycle (1->2)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.COMPLETED,
      completedCycles: 11,
      energyConsumption: 1280.5, // +30 kWh
      waterConsumption: 52.5,   // +7.3 L
    }), new Date());

    // This should emit cycle:closed with OK status
    expect(emitCycleClosed).toHaveBeenCalledWith(expect.objectContaining({
      cycleStatusLabel: CycleStatusLabel[CycleStatus.COMPLETED], // 'OK'
      cycleNumber: 11,
      endEnergyKwh: 1280.5,
      endWaterL: 52.5,
    }));
    // Verify deltas are approximately correct (floating point)
    const emitted = emitCycleClosed.mock.calls[0][0];
    expect(emitted.energyKwh).toBeCloseTo(30, 1);
    expect(emitted.waterL).toBeCloseTo(7.3, 1);
  });

  // ==========================================================================
  // Test 3: Rising edge 1→3 emits FAILED cycle event
  // ==========================================================================
  it('Cycle_Status 1->3 edge detection emits FAILED cycle event', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Start cycle (0->1)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
      energyConsumption: 1250.0,
      waterConsumption: 45.0,
    }), new Date());

    // Step 3: Fail cycle (1->3)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.FAILED,
      completedCycles: 11,
      energyConsumption: 1260.0,
      waterConsumption: 48.0,
    }), new Date());

    expect(emitCycleClosed).toHaveBeenCalledWith(expect.objectContaining({
      cycleStatusLabel: CycleStatusLabel[CycleStatus.FAILED], // 'FAILED'
      cycleNumber: 11,
    }));
  });

  // ==========================================================================
  // Test 4: Rising edge 1→4 emits ABORTED cycle event
  // ==========================================================================
  it('Cycle_Status 1->4 edge detection emits ABORTED cycle event', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Start cycle (0->1)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
      energyConsumption: 1250.0,
      waterConsumption: 45.0,
    }), new Date());

    // Step 3: Abort cycle (1->4)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.ABORTED,
      completedCycles: 11,
      energyConsumption: 1255.0,
      waterConsumption: 47.0,
    }), new Date());

    expect(emitCycleClosed).toHaveBeenCalledWith(expect.objectContaining({
      cycleStatusLabel: CycleStatusLabel[CycleStatus.ABORTED], // 'ABORTED'
      cycleNumber: 11,
      attributionStatusHint: 'ABORTED',
    }));
  });

  // ==========================================================================
  // Test 5: Skipped state 0→2 logs WARN and emits data_gap annotation
  // ==========================================================================
  it('Skipped state 0->2 logs WARN and emits data_gap annotation', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Direct transition: NONE -> COMPLETED (skipped CYCLE_START)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.COMPLETED,
      completedCycles: 11,
      energyConsumption: 1290.0,
      waterConsumption: 55.0,
    }), new Date());

    // Should log warning about skipped state
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'V03CycleTracker' }),
      expect.stringContaining('Skipped CYCLE_START state'),
    );

    // Should emit with NULL start counters and data_gap annotation
    expect(emitCycleClosed).toHaveBeenCalledWith(expect.objectContaining({
      cycleStatusLabel: 'OK',
      startEnergyKwh: null,
      startWaterL: null,
      dataGap: true,
    }));
  });

  // ==========================================================================
  // Test 6: Stuck cycle (>24h in CYCLE_START) logs WARN only
  // ==========================================================================
  it('Stuck cycle (>24h in CYCLE_START) logs WARN only', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    const now = new Date();

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), now);

    // Step 2: Start cycle (0->1) 25 hours ago
    const startTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
    }), startTime);

    // Clear mocks to isolate the stuck cycle check
    vi.clearAllMocks();

    // Step 3: Emit another CYCLE_START status (still in start state after 25h)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
    }), now);

    // Should log warning but NOT auto-close
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'V03CycleTracker' }),
      expect.stringContaining('Stuck cycle'),
    );

    // Should NOT emit cycle closed
    expect(emitCycleClosed).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 7: Counter reset during cycle clears in-flight state
  // ==========================================================================
  it('Counter reset during cycle clears in-flight state', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish initial state with completedCycles = 10
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: completedCycles decreases (reset detected)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 0, // Dropped from 10 to 0 (reset)
    }), new Date());

    // Should reset epoch and clear in-flight state
    // The next cycle should start fresh
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'V03CycleTracker', resetEpoch: 1 }),
      expect.stringContaining('Counter reset detected'),
    );
  });

  // ==========================================================================
  // Test 8: In-memory snapshot holds start counters until cycle end
  // ==========================================================================
  it('In-memory snapshot holds start counters until cycle end', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Start snapshot captured (0->1)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
      energyConsumption: 1000.0,
      waterConsumption: 20.0,
      user: 'OPERATOR1',
      orderNumber: 'ORDER-001',
      container: 5,
    }), new Date());

    // Step 3: Intermediate snapshots with same cycleStatus (still 1)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
      energyConsumption: 1050.0, // Changed but not captured
    }), new Date());

    // Step 4: End snapshot (1->2)
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.COMPLETED,
      completedCycles: 11,
      energyConsumption: 1100.0,
      waterConsumption: 30.0,
    }), new Date());

    // Emit should have original start values, not mid values
    expect(emitCycleClosed).toHaveBeenCalledWith(expect.objectContaining({
      startEnergyKwh: 1000.0, // Original start value
      startWaterL: 20.0,      // Original start value
      endEnergyKwh: 1100.0,   // End value
      endWaterL: 30.0,        // End value
      operator: 'OPERATOR1',
      containers: 5,
    }));
    // Verify orderNumber is also captured
    const emitted = emitCycleClosed.mock.calls[0][0];
    expect(emitted.orderNumber).toBe('ORDER-001');
  });

  // ==========================================================================
  // Test 9: Edge case - rapid status changes
  // ==========================================================================
  it('Rapid status changes within debounce window are coalesced', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Rapid transitions: 0->1->2 within same test
    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.CYCLE_START,
      completedCycles: 10,
    }), new Date());

    machineDataHandler!(makeSnapshot({
      cycleStatus: CycleStatus.COMPLETED,
      completedCycles: 11,
    }), new Date());

    // Should result in a single cycle close event
    expect(emitCycleClosed).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Test 10: Edge case - invalid status values are logged and ignored
  // ==========================================================================
  it('Invalid Cycle_Status values (5+) are logged and ignored', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    startV03CycleTracker(log);

    // Step 1: Establish NONE state
    machineDataHandler!(makeSnapshot({ cycleStatus: CycleStatus.NONE, completedCycles: 10 }), new Date());

    // Step 2: Invalid status value (5 is reserved per spec)
    machineDataHandler!(makeSnapshot({
      cycleStatus: 5,
      completedCycles: 10,
    }), new Date());

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'V03CycleTracker', cycleStatus: 5 }),
      expect.stringContaining('Unknown cycleStatus value: 5'),
    );

    expect(emitCycleClosed).not.toHaveBeenCalled();
  });
});
