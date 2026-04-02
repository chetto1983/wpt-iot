import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IJobData } from '@wpt/types';
import { CycleType, RemoteJobEnable, MaintenanceRequest, RemoteCycleSelection } from '@wpt/types';

// Mock the db module
vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

// Mock the hub to capture subscription handlers
vi.mock('../events/hub.js', () => ({
  dataHub: {
    onJobData: vi.fn(),
  },
}));

import { startJobStore } from '../persistence/jobStore.js';
import { jobs, jobChanges } from '../db/schema/jobs.js';
import { db } from '../db/index.js';
import { dataHub } from '../events/hub.js';

const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
};

/** Helper to extract the handler passed to onJobData */
function getJobHandler(): (job: IJobData) => Promise<void> {
  const calls = vi.mocked(dataHub.onJobData).mock.calls;
  return calls[calls.length - 1]![0] as unknown as (job: IJobData) => Promise<void>;
}

/** Create a default IJobData for testing */
function makeJob(overrides?: Partial<IJobData>): IJobData {
  return {
    supervisor: 'TestSupervisor',
    orderNumber: 'ORD-001',
    serialNumber: 'SN-001',
    remoteJobEnable: RemoteJobEnable.NO_REQUEST,
    maintenanceRequest: MaintenanceRequest.NO_REQUEST,
    remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
    cycleType: CycleType.NO_CYCLE,
    ...overrides,
  };
}

describe('jobStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: select returns empty (first event, no previous data)
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);
    // Default mock: insert chain
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);
  });

  it('subscribes to dataHub.onJobData', () => {
    startJobStore(mockLog);
    expect(dataHub.onJobData).toHaveBeenCalledOnce();
  });

  it('upserts job row with id=1 on first event (no diff log)', async () => {
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    startJobStore(mockLog);
    const handler = getJobHandler();

    const job = makeJob();
    await handler(job);

    // Should only insert into jobs table (upsert), not jobChanges
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(jobs);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      supervisor: 'TestSupervisor',
    }));
    expect(mockOnConflict).toHaveBeenCalledWith(expect.objectContaining({
      target: jobs.id,
    }));
  });

  it('inserts diff log entry when job data changes', async () => {
    // Setup: select returns existing job with different supervisor
    const existingJob = {
      id: 1,
      supervisor: 'OldSupervisor',
      orderNumber: 'ORD-001',
      serialNumber: 'SN-001',
      remoteJobEnable: 0,
      maintenanceRequest: 0,
      remoteCycleSelection: 0,
      cycleType: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockWhere = vi.fn().mockResolvedValue([existingJob]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    // Track insert calls to distinguish jobs vs jobChanges
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValuesUpsert = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    const mockValuesChange = vi.fn().mockResolvedValue(undefined);

    vi.mocked(db.insert).mockImplementation((table: unknown) => {
      if (table === jobChanges) {
        return { values: mockValuesChange } as never;
      }
      return { values: mockValuesUpsert } as never;
    });

    startJobStore(mockLog);
    const handler = getJobHandler();

    const job = makeJob({ supervisor: 'NewSupervisor' });
    await handler(job);

    // Should have inserted diff log
    expect(mockValuesChange).toHaveBeenCalledWith(expect.objectContaining({
      previousSupervisor: 'OldSupervisor',
      currentSupervisor: 'NewSupervisor',
    }));
  });

  it('does NOT insert diff log when data is identical', async () => {
    // Setup: select returns job with SAME data
    const existingJob = {
      id: 1,
      supervisor: 'TestSupervisor',
      orderNumber: 'ORD-001',
      serialNumber: 'SN-001',
      remoteJobEnable: 0,
      maintenanceRequest: 0,
      remoteCycleSelection: 0,
      cycleType: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockWhere = vi.fn().mockResolvedValue([existingJob]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const insertedTables: unknown[] = [];
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    vi.mocked(db.insert).mockImplementation((table: unknown) => {
      insertedTables.push(table);
      return { values: mockValues } as never;
    });

    startJobStore(mockLog);
    const handler = getJobHandler();

    const job = makeJob();
    await handler(job);

    // Should only insert into jobs (upsert), NOT jobChanges
    expect(insertedTables).not.toContain(jobChanges);
    expect(insertedTables).toContain(jobs);
  });

  it('logs error and does NOT throw on DB failure (D-12 resilience)', async () => {
    const mockWhere = vi.fn().mockRejectedValue(new Error('connection refused'));
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    startJobStore(mockLog);
    const handler = getJobHandler();

    const job = makeJob();

    // Should not throw
    await handler(job);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'JobStore' }),
      expect.stringContaining('Failed to persist job data'),
    );
  });
});
