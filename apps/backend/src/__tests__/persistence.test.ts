import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module - factory must not reference outer variables
vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  },
}));

// Mock the hub to capture subscription handlers
vi.mock('../events/hub.js', () => ({
  dataHub: {
    onMachineData: vi.fn(),
    onAlarmChange: vi.fn(),
  },
}));

import { startMachineStore } from '../persistence/machineStore.js';
import { startAlarmStore, getActiveAlarmIndices } from '../persistence/alarmStore.js';
import { machineSnapshots } from '../db/schema/machine.js';
import { alarmEvents } from '../db/schema/alarms.js';
import { db } from '../db/index.js';
import { dataHub } from '../events/hub.js';

const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
};

/** Helper to extract the handler passed to onMachineData */
function getMachineHandler(): (snapshot: Record<string, unknown>, timestamp: Date) => Promise<void> {
  const calls = vi.mocked(dataHub.onMachineData).mock.calls;
  return calls[calls.length - 1]![0] as (snapshot: Record<string, unknown>, timestamp: Date) => Promise<void>;
}

/** Helper to extract the handler passed to onAlarmChange */
function getAlarmHandler(): (transitions: Array<Record<string, unknown>>) => Promise<void> {
  const calls = vi.mocked(dataHub.onAlarmChange).mock.calls;
  return calls[calls.length - 1]![0] as (transitions: Array<Record<string, unknown>>) => Promise<void>;
}

describe('machineStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values
    const mockValues = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);
  });

  it('subscribes to dataHub.onMachineData', () => {
    startMachineStore(mockLog);
    expect(dataHub.onMachineData).toHaveBeenCalledOnce();
  });

  it('inserts into machineSnapshots when machine:data fires', async () => {
    const mockValues = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    startMachineStore(mockLog);
    const handler = getMachineHandler();

    const snapshot = { garbageTemp: 350, chamberPressure: -20 };
    const timestamp = new Date('2026-01-01T00:00:00Z');

    await handler(snapshot, timestamp);

    expect(db.insert).toHaveBeenCalledWith(machineSnapshots);
    expect(mockValues).toHaveBeenCalledWith({
      timestamp,
      ...snapshot,
    });
  });

  it('logs and does NOT throw on DB error (D-12 resilience)', async () => {
    const mockValues = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    startMachineStore(mockLog);
    const handler = getMachineHandler();

    const snapshot = { garbageTemp: 350 };
    const timestamp = new Date();

    // Should not throw
    await handler(snapshot, timestamp);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MachineStore' }),
      expect.stringContaining('Failed to persist machine snapshot'),
    );
  });
});

describe('alarmStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values
    const mockValues = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as never);
  });

  it('subscribes to dataHub.onAlarmChange', () => {
    startAlarmStore(mockLog);
    expect(dataHub.onAlarmChange).toHaveBeenCalledOnce();
  });

  it('inserts ACTIVE row on active alarm transition', async () => {
    const mockValues = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    startAlarmStore(mockLog);
    const handler = getAlarmHandler();

    const transitions = [{
      alarmIndex: 5,
      wordIndex: 0,
      bitIndex: 5,
      active: true,
      timestamp: new Date('2026-01-01T00:00:00Z'),
    }];

    await handler(transitions);

    expect(db.insert).toHaveBeenCalledWith(alarmEvents);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      alarmIndex: 5,
      active: true,
      transitionType: 'ACTIVE',
      resetAt: null,
    }));
  });

  it('updates with CLEAR on inactive alarm transition', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as never);

    startAlarmStore(mockLog);
    const handler = getAlarmHandler();

    const transitions = [{
      alarmIndex: 5,
      wordIndex: 0,
      bitIndex: 5,
      active: false,
      timestamp: new Date('2026-01-01T00:01:00Z'),
    }];

    await handler(transitions);

    expect(db.update).toHaveBeenCalledWith(alarmEvents);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      active: false,
      transitionType: 'CLEAR',
    }));
  });

  it('logs and does NOT throw on DB error (D-12 resilience)', async () => {
    const mockValues = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    startAlarmStore(mockLog);
    const handler = getAlarmHandler();

    const transitions = [{
      alarmIndex: 1,
      wordIndex: 0,
      bitIndex: 1,
      active: true,
      timestamp: new Date(),
    }];

    // Should not throw
    await handler(transitions);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AlarmStore' }),
      expect.stringContaining('Failed to persist alarm transition'),
    );
  });
});

describe('getActiveAlarmIndices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is exported and callable', () => {
    expect(getActiveAlarmIndices).toBeTypeOf('function');
  });

  it('returns alarm indices from DB query', async () => {
    const mockWhere = vi.fn().mockResolvedValue([
      { alarmIndex: 3 },
      { alarmIndex: 17 },
      { alarmIndex: 42 },
    ]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const indices = await getActiveAlarmIndices();
    expect(indices).toEqual([3, 17, 42]);
  });

  it('returns empty array when no active alarms', async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const indices = await getActiveAlarmIndices();
    expect(indices).toEqual([]);
  });
});
