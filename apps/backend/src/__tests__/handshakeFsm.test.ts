import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandshakeFSM, initHandshakeFsms, readUsers, writeUsers, readJob, writeJob, resetHandshakeChannel } from '../udp/handshakeFsm.js';
import { HandshakeState, RfidUserGroup, CycleType, RemoteJobEnable, MaintenanceRequest, RemoteCycleSelection } from '@wpt/types';
import type { IRfidUser, IJobData } from '@wpt/types';
import { USER_DATA_PACKET_SIZE, JOB_DATA_PACKET_SIZE } from '../udp/packetSizes.js';
import { buildUserWritePacket, buildJobWritePacket } from '../udp/parsers.js';

// ---------------------------------------------------------------------------
// Mock socket helper
// ---------------------------------------------------------------------------
interface IMockSocket {
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  simulateMessage: (buf: Buffer) => void;
}

function createMockSocket(): IMockSocket {
  const listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? [];
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    }),
    send: vi.fn((_msg: Buffer, _offset: number, _length: number, _port: number, _host: string, cb?: (err: Error | null) => void) => {
      cb?.(null);
    }),
    close: vi.fn(),
    simulateMessage: (buf: Buffer) => {
      for (const handler of [...(listeners.get('message') ?? [])]) {
        handler(buf, { address: '127.0.0.1', port: 19093 });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test log helper
// ---------------------------------------------------------------------------
const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers to build ACK + data buffers
// ---------------------------------------------------------------------------
function buildAckBuffer(byte9090: number, byte9092: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(byte9090, 0);
  buf.writeUInt8(byte9092, 1);
  return buf;
}

function buildTestUserDataBuffer(): Buffer {
  const users: IRfidUser[] = [];
  for (let i = 0; i < 48; i++) {
    users.push({
      tagId: i + 1,
      name: i === 0 ? 'TestUser' : '',
      group: RfidUserGroup.OPERATOR,
      enabled: i === 0,
    });
  }
  return buildUserWritePacket(users);
}

function buildTestJobDataBuffer(): Buffer {
  const job: IJobData = {
    supervisor: 'SuperVisor',
    orderNumber: 'ORD-123',
    serialNumber: 'SN-456',
    remoteJobEnable: RemoteJobEnable.NO_REQUEST,
    maintenanceRequest: MaintenanceRequest.NO_REQUEST,
    remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
    cycleType: CycleType.DRY_MIXED,
    spareInt02: 0,  // V03 (Phase 19.1 Wave 1)
    spareInt03: 0,  // V03 (Phase 19.1 Wave 1)
  };
  return buildJobWritePacket(job);
}

/**
 * Helper to schedule simulated messages after microtask tick.
 * The FSM registers its socket listeners inside async code. After calling
 * fsm.read() or fsm.write(), we need at least one microtask tick for the
 * code to reach the waitForAck/waitForData listener registration.
 * We use a short real setTimeout to ensure listeners are registered.
 */
function scheduleAfterTick(fn: () => void): void {
  setTimeout(fn, 5);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HandshakeFSM', () => {
  let usersFsm: HandshakeFSM;
  let jobsFsm: HandshakeFSM;

  beforeEach(() => {
    vi.clearAllMocks();
    usersFsm = new HandshakeFSM({
      channelName: 'users',
      controlByteIndex: 1,
      simTargetDataPort: 19092,
      expectedDataSize: USER_DATA_PACKET_SIZE,
      watchdogMs: 200, // Short timeout for tests
    });
    jobsFsm = new HandshakeFSM({
      channelName: 'jobs',
      controlByteIndex: 0,
      simTargetDataPort: 19090,
      expectedDataSize: JOB_DATA_PACKET_SIZE,
      watchdogMs: 200,
    });
  });

  // ----- Control byte positioning -----

  describe('control byte positioning', () => {
    it('users FSM writes REQUEST_READ at byte index 1, IDLE at byte index 0', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      const readPromise = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);

      // `sendControl` awaits getCachedPlcConfig() before calling ackSocket.send,
      // so the first send is NOT synchronous. Schedule ACK+data, await the
      // read, then assert on the recorded calls. The read path sends three
      // control messages: REQUEST_READ, ACK release, then IDLE cleanup.
      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(buildTestUserDataBuffer());
        });
      });

      await readPromise;

      expect(ackSocket.send).toHaveBeenCalledTimes(3);
      const sentMsg: Buffer = ackSocket.send.mock.calls[0]![0];
      const releaseMsg: Buffer = ackSocket.send.mock.calls[1]![0];
      const cleanupMsg: Buffer = ackSocket.send.mock.calls[2]![0];
      expect(sentMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(sentMsg.readUInt8(1)).toBe(HandshakeState.REQUEST_READ);
      expect(releaseMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(releaseMsg.readUInt8(1)).toBe(HandshakeState.ACK);
      expect(cleanupMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(cleanupMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
    }, 10000);

    it('jobs FSM writes REQUEST_READ at byte index 0, IDLE at byte index 1', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      const readPromise = jobsFsm.read(ackSocket as any, dataSocket as any, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(buildTestJobDataBuffer());
        });
      });

      await readPromise;

      expect(ackSocket.send).toHaveBeenCalledTimes(3);
      const sentMsg: Buffer = ackSocket.send.mock.calls[0]![0];
      const releaseMsg: Buffer = ackSocket.send.mock.calls[1]![0];
      const cleanupMsg: Buffer = ackSocket.send.mock.calls[2]![0];
      expect(sentMsg.readUInt8(0)).toBe(HandshakeState.REQUEST_READ);
      expect(sentMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
      expect(releaseMsg.readUInt8(0)).toBe(HandshakeState.ACK);
      expect(releaseMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
      expect(cleanupMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(cleanupMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
    }, 10000);

    it('users FSM writes REQUEST_WRITE at byte index 1', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();
      const dataBuffer = buildTestUserDataBuffer();

      const writePromise = usersFsm.write(ackSocket as any, dataSocket as any, dataBuffer, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
      });

      await writePromise;

      expect(ackSocket.send).toHaveBeenCalledTimes(3);
      const sentMsg: Buffer = ackSocket.send.mock.calls[0]![0];
      const releaseMsg: Buffer = ackSocket.send.mock.calls[1]![0];
      const cleanupMsg: Buffer = ackSocket.send.mock.calls[2]![0];
      expect(sentMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(sentMsg.readUInt8(1)).toBe(HandshakeState.REQUEST_WRITE);
      expect(releaseMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(releaseMsg.readUInt8(1)).toBe(HandshakeState.ACK);
      expect(cleanupMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(cleanupMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
    }, 10000);

    it('jobs FSM writes REQUEST_WRITE at byte index 0', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();
      const dataBuffer = buildTestJobDataBuffer();

      const writePromise = jobsFsm.write(ackSocket as any, dataSocket as any, dataBuffer, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
      });

      await writePromise;

      expect(ackSocket.send).toHaveBeenCalledTimes(3);
      const sentMsg: Buffer = ackSocket.send.mock.calls[0]![0];
      const releaseMsg: Buffer = ackSocket.send.mock.calls[1]![0];
      const cleanupMsg: Buffer = ackSocket.send.mock.calls[2]![0];
      expect(sentMsg.readUInt8(0)).toBe(HandshakeState.REQUEST_WRITE);
      expect(sentMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
      expect(releaseMsg.readUInt8(0)).toBe(HandshakeState.ACK);
      expect(releaseMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
      expect(cleanupMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(cleanupMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
    }, 10000);
  });

  // ----- Read users -----

  describe('read users', () => {
    it('sends REQUEST_READ, receives ACK, receives data, returns buffer', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();
      const userDataBuf = buildTestUserDataBuffer();

      const readPromise = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(userDataBuf);
        });
      });

      const result = await readPromise;
      expect(result.length).toBeGreaterThanOrEqual(USER_DATA_PACKET_SIZE);
      expect(usersFsm.getState()).toBe(HandshakeState.IDLE);
      expect(usersFsm.isBusy()).toBe(false);
    }, 10000);
  });

  // ----- Read jobs -----

  describe('read jobs', () => {
    it('sends REQUEST_READ, receives ACK, receives job data, returns buffer', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();
      const jobDataBuf = buildTestJobDataBuffer();

      const readPromise = jobsFsm.read(ackSocket as any, dataSocket as any, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(jobDataBuf);
        });
      });

      const result = await readPromise;
      expect(result.length).toBeGreaterThanOrEqual(JOB_DATA_PACKET_SIZE);
      expect(jobsFsm.getState()).toBe(HandshakeState.IDLE);
    }, 10000);
  });

  // ----- Write users -----

  describe('write users', () => {
    it('sends REQUEST_WRITE, receives ACK, sends data packet to sim port', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();
      const userDataBuf = buildTestUserDataBuffer();

      const writePromise = usersFsm.write(ackSocket as any, dataSocket as any, userDataBuf, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
      });

      await writePromise;

      expect(dataSocket.send).toHaveBeenCalledTimes(1);
      const sentData: Buffer = dataSocket.send.mock.calls[0]![0];
      expect(sentData.length).toBe(USER_DATA_PACKET_SIZE);
      expect(usersFsm.getState()).toBe(HandshakeState.IDLE);
    }, 10000);
  });

  // ----- Write jobs -----

  describe('write jobs', () => {
    it('sends REQUEST_WRITE, receives ACK, sends job data to sim data port', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();
      const jobDataBuf = buildTestJobDataBuffer();

      const writePromise = jobsFsm.write(ackSocket as any, dataSocket as any, jobDataBuf, mockLog);

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
      });

      await writePromise;

      expect(dataSocket.send).toHaveBeenCalledTimes(1);
      const sentData: Buffer = dataSocket.send.mock.calls[0]![0];
      expect(sentData.length).toBe(JOB_DATA_PACKET_SIZE);
      expect(jobsFsm.getState()).toBe(HandshakeState.IDLE);
    }, 10000);
  });

  // ----- Concurrent rejection (D-05) -----

  describe('concurrent rejection', () => {
    it('rejects a second read while a read is in progress', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      // Start first read (will not complete immediately)
      const firstRead = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);

      // Attempt second read immediately -- should reject synchronously
      await expect(
        usersFsm.read(ackSocket as any, dataSocket as any, mockLog)
      ).rejects.toThrow('Handshake in progress on users');

      // Clean up: complete first read
      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(buildTestUserDataBuffer());
        });
      });
      await firstRead;
    }, 10000);

    it('rejects a write while a read is in progress', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      const firstRead = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);

      await expect(
        usersFsm.write(ackSocket as any, dataSocket as any, buildTestUserDataBuffer(), mockLog)
      ).rejects.toThrow('Handshake in progress on users');

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(buildTestUserDataBuffer());
        });
      });
      await firstRead;
    }, 10000);

    it('rejects a second write while a write is in progress', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      const firstWrite = jobsFsm.write(ackSocket as any, dataSocket as any, buildTestJobDataBuffer(), mockLog);

      await expect(
        jobsFsm.write(ackSocket as any, dataSocket as any, buildTestJobDataBuffer(), mockLog)
      ).rejects.toThrow('Handshake in progress on jobs');

      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
      });
      await firstWrite;
    }, 10000);
  });

  // ----- Timeout (D-06) -----

  describe('watchdog timeout', () => {
    it('rejects with timeout error if no data received within watchdogMs', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      // watchdogMs is 200ms for tests -- just let it expire
      const readPromise = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);

      await expect(readPromise).rejects.toThrow('Handshake timeout on users: no data within 200ms');
      expect(usersFsm.getState()).toBe(HandshakeState.IDLE);
      expect(usersFsm.isBusy()).toBe(false);
    }, 10000);

    it('rejects with timeout error if no ACK received for write', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      const writePromise = usersFsm.write(ackSocket as any, dataSocket as any, buildTestUserDataBuffer(), mockLog);

      await expect(writePromise).rejects.toThrow('Handshake timeout on users: no ACK within 200ms');
      expect(usersFsm.getState()).toBe(HandshakeState.IDLE);
      expect(usersFsm.isBusy()).toBe(false);
    }, 10000);

    // NOTE: the "write timeout if no ACK" test was removed 2026-04-09.
    // The real ABB AC500 PLC 9092 write path is TRULY fire-and-forget
    // (verified 2026-04-08 via tcpdump — zero PLC→Backend frames on the
    // 5-second post-send capture window). handshakeFsm.write() no longer
    // awaits any ACK, so there is no timeout to assert. Write failures
    // can only surface via UDP send errors. See handshakeFsm.ts write()
    // doc block for the wire evidence.

    it('rejects with timeout error if ACK received but no data arrives for read', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      const readPromise = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);

      // Send ACK but NO data
      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
      });
      // Let data timeout expire

      await expect(readPromise).rejects.toThrow('Handshake timeout on users: no data within 200ms');
    }, 10000);
  });

  // ----- Timeout recovery -----

  describe('timeout recovery', () => {
    it('after timeout, next read succeeds normally', async () => {
      const ackSocket = createMockSocket();
      const dataSocket = createMockSocket();

      // First read times out (200ms watchdog)
      const readPromise1 = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);
      await expect(readPromise1).rejects.toThrow('Handshake timeout');
      expect(usersFsm.isBusy()).toBe(false);

      // Second read succeeds
      const readPromise2 = usersFsm.read(ackSocket as any, dataSocket as any, mockLog);
      scheduleAfterTick(() => {
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
        scheduleAfterTick(() => {
          dataSocket.simulateMessage(buildTestUserDataBuffer());
        });
      });
      const result = await readPromise2;
      expect(result.length).toBeGreaterThanOrEqual(USER_DATA_PACKET_SIZE);
      expect(usersFsm.getState()).toBe(HandshakeState.IDLE);
    }, 10000);
  });

  // ----- Independent channels -----

  describe('independent channels', () => {
    it('users and jobs FSM can operate simultaneously', async () => {
      const ackSocket = createMockSocket();
      const userDataSocket = createMockSocket();
      const jobDataSocket = createMockSocket();

      // Start both reads
      const usersRead = usersFsm.read(ackSocket as any, userDataSocket as any, mockLog);
      const jobsRead = jobsFsm.read(ackSocket as any, jobDataSocket as any, mockLog);

      // Both should be busy
      expect(usersFsm.isBusy()).toBe(true);
      expect(jobsFsm.isBusy()).toBe(true);

      scheduleAfterTick(() => {
        // Send ACK for users (byte index 1 = ACK, byte index 0 = IDLE)
        ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
        scheduleAfterTick(() => {
          userDataSocket.simulateMessage(buildTestUserDataBuffer());
          scheduleAfterTick(() => {
            // Now send ACK for jobs (byte index 0 = ACK, byte index 1 = IDLE)
            ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
            scheduleAfterTick(() => {
              jobDataSocket.simulateMessage(buildTestJobDataBuffer());
            });
          });
        });
      });

      await usersRead;
      expect(usersFsm.isBusy()).toBe(false);

      await jobsRead;
      expect(jobsFsm.isBusy()).toBe(false);
    }, 10000);
  });

  // ----- Reset channel -----

  describe('resetChannel', () => {
    it('sends IDLE on control port and resets state', async () => {
      const ackSocket = createMockSocket();

      await usersFsm.resetChannel(ackSocket as any);

      expect(ackSocket.send).toHaveBeenCalledTimes(1);
      const sentMsg: Buffer = ackSocket.send.mock.calls[0]![0];
      expect(sentMsg.readUInt8(0)).toBe(HandshakeState.IDLE);
      expect(sentMsg.readUInt8(1)).toBe(HandshakeState.IDLE);
      expect(usersFsm.getState()).toBe(HandshakeState.IDLE);
      expect(usersFsm.isBusy()).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Convenience function tests (init + readUsers/writeUsers/readJob/writeJob)
// ---------------------------------------------------------------------------

describe('Convenience functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initHandshakeFsms();
  });

  it('readUsers parses returned buffer into IRfidUser array', async () => {
    const ackSocket = createMockSocket();
    const dataSocket = createMockSocket();
    const userDataBuf = buildTestUserDataBuffer();

    const readPromise = readUsers(ackSocket as any, dataSocket as any, mockLog);
    scheduleAfterTick(() => {
      ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
      scheduleAfterTick(() => {
        dataSocket.simulateMessage(userDataBuf);
      });
    });

    const users = await readPromise;
    expect(users).toHaveLength(48);
    expect(users[0]!.tagId).toBe(1);
    expect(users[0]!.name).toBe('TestUser');
    expect(users[0]!.group).toBe(RfidUserGroup.OPERATOR);
    expect(users[0]!.enabled).toBe(true);
  }, 10000);

  it('writeUsers builds and sends a user write packet', async () => {
    const ackSocket = createMockSocket();
    const dataSocket = createMockSocket();
    const users: IRfidUser[] = Array.from({ length: 48 }, (_, i) => ({
      tagId: i + 1,
      name: i === 0 ? 'NewUser' : '',
      group: RfidUserGroup.OPERATOR,
      enabled: i === 0,
    }));

    const writePromise = writeUsers(ackSocket as any, dataSocket as any, users, mockLog);
    scheduleAfterTick(() => {
      ackSocket.simulateMessage(buildAckBuffer(HandshakeState.IDLE, HandshakeState.ACK));
    });
    await writePromise;

    expect(dataSocket.send).toHaveBeenCalledTimes(1);
    const sentData: Buffer = dataSocket.send.mock.calls[0]![0];
    expect(sentData.length).toBe(USER_DATA_PACKET_SIZE);
  }, 10000);

  it('readJob parses returned buffer into IJobData', async () => {
    const ackSocket = createMockSocket();
    const dataSocket = createMockSocket();
    const jobDataBuf = buildTestJobDataBuffer();

    const readPromise = readJob(ackSocket as any, dataSocket as any, mockLog);
    scheduleAfterTick(() => {
      ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
      scheduleAfterTick(() => {
        dataSocket.simulateMessage(jobDataBuf);
      });
    });

    const job = await readPromise;
    expect(job.supervisor).toBe('SuperVisor');
    expect(job.orderNumber).toBe('ORD-123');
    expect(job.serialNumber).toBe('SN-456');
    expect(job.cycleType).toBe(CycleType.DRY_MIXED);
  }, 10000);

  it('writeJob builds and sends a job write packet', async () => {
    const ackSocket = createMockSocket();
    const dataSocket = createMockSocket();
    const job: IJobData = {
      supervisor: 'Admin',
      orderNumber: 'ORD-999',
      serialNumber: 'SN-001',
      remoteJobEnable: RemoteJobEnable.NEW_CYCLE_JOB_ENTRY,
      maintenanceRequest: MaintenanceRequest.NO_REQUEST,
      remoteCycleSelection: RemoteCycleSelection.NO_REQUEST,
      cycleType: CycleType.ORGANIC,
      spareInt02: 0,  // V03 (Phase 19.1 Wave 1)
      spareInt03: 0,  // V03 (Phase 19.1 Wave 1)
    };

    const writePromise = writeJob(ackSocket as any, dataSocket as any, job, mockLog);
    scheduleAfterTick(() => {
      ackSocket.simulateMessage(buildAckBuffer(HandshakeState.ACK, HandshakeState.IDLE));
    });
    await writePromise;

    expect(dataSocket.send).toHaveBeenCalledTimes(1);
    const sentData: Buffer = dataSocket.send.mock.calls[0]![0];
    expect(sentData.length).toBe(JOB_DATA_PACKET_SIZE);
  }, 10000);

  it('resetHandshakeChannel resets both channels', async () => {
    const ackSocket = createMockSocket();
    await resetHandshakeChannel(ackSocket as any);
    // Should have sent 2 IDLE messages (one per FSM)
    expect(ackSocket.send).toHaveBeenCalledTimes(2);
  });
});
