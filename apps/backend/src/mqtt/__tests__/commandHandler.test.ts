import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IJobData, IRfidUser } from '@wpt/types';
import {
  CycleType,
  RemoteJobEnable,
  MaintenanceRequest,
  RemoteCycleSelection,
  RfidUserGroup,
} from '@wpt/types';

// ---------------------------------------------------------------------------
// Mocks must be hoisted before importing the SUT.
// ---------------------------------------------------------------------------

const writeJob = vi.fn();
const writeUsers = vi.fn();
const readJob = vi.fn();
const emitJobData = vi.fn();
const emitUserData = vi.fn();
const getSockets = vi.fn(() => ({
  ackSocket: {} as never,
  dataSocket: {} as never,
  userSocket: {} as never,
}));

vi.mock('../../udp/handshakeFsm.js', () => ({
  writeJob,
  writeUsers,
  readJob,
}));

vi.mock('../../events/hub.js', () => ({
  dataHub: {
    emitJobData,
    emitUserData,
  },
}));

vi.mock('../../udp/sockets.js', () => ({
  getSockets,
}));

// Avoid pulling the real config (db, dotenv, etc.). Tests don't need real values.
vi.mock('../../config.js', () => ({
  config: {
    mqttSiteId: 'site-test',
    mqttMachineId: 'machine-test',
  },
}));

// Import AFTER mocks are registered so the module-under-test sees the stubs.
const { routeCommand } = await import('../commandHandler.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides?: Partial<IJobData>): IJobData {
  return {
    supervisor: 'TestSupervisor',
    orderNumber: 'ORD-001',
    serialNumber: 'SN-001',
    remoteJobEnable: RemoteJobEnable.NO_REQUEST,
    maintenanceRequest: MaintenanceRequest.NO_REQUEST,
    remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
    cycleType: CycleType.NO_CYCLE,
    spareInt02: 0,  // V03 (Phase 19.1 Wave 1)
    spareInt03: 0,  // V03 (Phase 19.1 Wave 1)
    ...overrides,
  };
}

function makeUser(tagId: number, overrides?: Partial<IRfidUser>): IRfidUser {
  return {
    tagId,
    name: `User${tagId}`,
    group: RfidUserGroup.OPERATOR,
    enabled: true,
    ...overrides,
  };
}

function make48Users(): IRfidUser[] {
  return Array.from({ length: 48 }, (_, i) => makeUser(i + 1));
}

const RESPONSE_TOPIC = 'wpt/site-test/machine-test/cmd/job/res';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commandHandler.routeCommand — dataHub emit wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: writeJob/writeUsers/readJob succeed unless overridden in a test.
    writeJob.mockResolvedValue(undefined);
    writeUsers.mockResolvedValue(undefined);
    readJob.mockResolvedValue(makeJob());
    // Reset sockets stub default.
    getSockets.mockReturnValue({
      ackSocket: {} as never,
      dataSocket: {} as never,
      userSocket: {} as never,
    });
  });

  it('job-success: emits emitJobData exactly once with the validated jobData payload', async () => {
    const jobPayload = makeJob({ supervisor: 'JobSuccessSup', orderNumber: 'JOB-001' });

    await routeCommand(
      'job',
      'req-job-1',
      jobPayload as unknown as Record<string, unknown>,
      RESPONSE_TOPIC,
      undefined,
    );

    expect(writeJob).toHaveBeenCalledTimes(1);
    expect(emitJobData).toHaveBeenCalledTimes(1);
    expect(emitJobData).toHaveBeenCalledWith(
      expect.objectContaining({
        supervisor: 'JobSuccessSup',
        orderNumber: 'JOB-001',
      }),
    );
    // Must not call the user emit on the job branch.
    expect(emitUserData).not.toHaveBeenCalled();
  });

  it('rfid-success: emits emitUserData exactly once with the validated 48-user array', async () => {
    const users = make48Users();

    await routeCommand(
      'rfid',
      'req-rfid-1',
      { users } as unknown as Record<string, unknown>,
      RESPONSE_TOPIC,
      undefined,
    );

    expect(writeUsers).toHaveBeenCalledTimes(1);
    expect(emitUserData).toHaveBeenCalledTimes(1);
    const emittedUsers = emitUserData.mock.calls[0]?.[0] as IRfidUser[];
    expect(emittedUsers).toHaveLength(48);
    expect(emittedUsers[0]).toEqual(
      expect.objectContaining({ tagId: 1, name: 'User1' }),
    );
    expect(emittedUsers[47]).toEqual(
      expect.objectContaining({ tagId: 48, name: 'User48' }),
    );
    // Must not call the job emit on the rfid branch.
    expect(emitJobData).not.toHaveBeenCalled();
  });

  it('cycle-success: emits emitJobData exactly once with the merged composite (NOT the baseline)', async () => {
    // readJob returns a baseline job with ORGANIC=4 NOT set; the overlay flips cycleType to ORGANIC.
    const baseline = makeJob({
      supervisor: 'BaselineSup',
      orderNumber: 'BASE-001',
      cycleType: CycleType.NO_CYCLE,
    });
    readJob.mockResolvedValue(baseline);

    await routeCommand(
      'cycle',
      'req-cycle-1',
      { cycleType: CycleType.ORGANIC } as unknown as Record<string, unknown>,
      RESPONSE_TOPIC,
      undefined,
    );

    // Both reads and writes should have happened, in order: read then write.
    expect(readJob).toHaveBeenCalledTimes(1);
    expect(writeJob).toHaveBeenCalledTimes(1);
    expect(emitJobData).toHaveBeenCalledTimes(1);

    // The emitted job MUST be the merged composite (overlay applied), not baseline.
    const emitted = emitJobData.mock.calls[0]?.[0] as IJobData;
    expect(emitted.cycleType).toBe(CycleType.ORGANIC);
    expect(emitted.supervisor).toBe('BaselineSup');
    expect(emitted.orderNumber).toBe('BASE-001');

    // The emit must fire AFTER writeJob (not after readJob alone).
    const readJobOrder = readJob.mock.invocationCallOrder[0]!;
    const writeJobOrder = writeJob.mock.invocationCallOrder[0]!;
    const emitOrder = emitJobData.mock.invocationCallOrder[0]!;
    expect(emitOrder).toBeGreaterThan(writeJobOrder);
    expect(writeJobOrder).toBeGreaterThan(readJobOrder);
  });

  it('job-write-failure: writeJob rejects → emitJobData NOT called, response has error status', async () => {
    writeJob.mockRejectedValue(new Error('handshake timeout'));

    const jobPayload = makeJob();

    // routeCommand swallows errors via commandQueue and replies with an error response.
    await routeCommand(
      'job',
      'req-job-fail',
      jobPayload as unknown as Record<string, unknown>,
      RESPONSE_TOPIC,
      undefined,
    );

    expect(writeJob).toHaveBeenCalledTimes(1);
    expect(emitJobData).not.toHaveBeenCalled();
    expect(emitUserData).not.toHaveBeenCalled();
  });

  it('cycle-read-failure: readJob rejects → neither writeJob nor emitJobData are called', async () => {
    readJob.mockRejectedValue(new Error('PLC timeout'));

    await routeCommand(
      'cycle',
      'req-cycle-readfail',
      { cycleType: CycleType.ORGANIC } as unknown as Record<string, unknown>,
      RESPONSE_TOPIC,
      undefined,
    );

    expect(readJob).toHaveBeenCalledTimes(1);
    expect(writeJob).not.toHaveBeenCalled();
    expect(emitJobData).not.toHaveBeenCalled();
    expect(emitUserData).not.toHaveBeenCalled();
  });

  it('rfid-write-failure: writeUsers rejects → emitUserData NOT called', async () => {
    writeUsers.mockRejectedValue(new Error('handshake timeout'));

    await routeCommand(
      'rfid',
      'req-rfid-fail',
      { users: make48Users() } as unknown as Record<string, unknown>,
      RESPONSE_TOPIC,
      undefined,
    );

    expect(writeUsers).toHaveBeenCalledTimes(1);
    expect(emitUserData).not.toHaveBeenCalled();
    expect(emitJobData).not.toHaveBeenCalled();
  });
});
