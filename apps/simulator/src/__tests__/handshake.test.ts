import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import { HandshakeState, RfidUserGroup } from '@wpt/types';
import type { IJobData, IRfidUser } from '@wpt/types';
import { buildJobWritePacket, buildUserDataPacket, parseUserData } from '@wpt/types/plc-wire';
import { Channel, HandshakeHandler, buildAckFrame, decodeControlFrame } from '../udp/handshakeHandler.js';
import { getState, resetState, updateState } from '../state/simulatorState.js';

const { IDLE, ACK, REQUEST_READ, REQUEST_WRITE } = HandshakeState;
const frame = (jobs: number, users: number): Buffer => Buffer.from([jobs, users]);

describe('decodeControlFrame', () => {
  it('reads a REQUEST_READ on the users byte', () => {
    expect(decodeControlFrame(frame(IDLE, REQUEST_READ))).toEqual([{ kind: 'read', channel: Channel.Users }]);
  });

  it('arms a write on whichever byte carries REQUEST_WRITE', () => {
    expect(decodeControlFrame(frame(REQUEST_WRITE, IDLE))).toEqual([{ kind: 'armWrite', channel: Channel.Jobs }]);
    expect(decodeControlFrame(frame(IDLE, REQUEST_WRITE))).toEqual([{ kind: 'armWrite', channel: Channel.Users }]);
  });

  it('asks nothing of the backend release frames (ACK, IDLE)', () => {
    expect(decodeControlFrame(frame(IDLE, ACK))).toEqual([]);
    expect(decodeControlFrame(frame(ACK, IDLE))).toEqual([]);
    expect(decodeControlFrame(frame(IDLE, IDLE))).toEqual([]);
  });

  it('ignores a job REQUEST_READ: the real PLC never sends job data back', () => {
    expect(decodeControlFrame(frame(REQUEST_READ, IDLE))).toEqual([]);
  });
});

describe('buildAckFrame', () => {
  it('puts the value on its channel byte and IDLE on the other', () => {
    expect([...buildAckFrame(Channel.Users, ACK)]).toEqual([IDLE, ACK]);
    expect([...buildAckFrame(Channel.Jobs, ACK)]).toEqual([ACK, IDLE]);
  });
});

/** A stand-in backend: the ack (9093) and users (9092) sockets the PLC answers to. */
interface IFakeBackend {
  ack: dgram.Socket;
  users: dgram.Socket;
  next: (socket: dgram.Socket, timeoutMs?: number) => Promise<Buffer | null>;
  close: () => void;
}

async function bindLocal(): Promise<dgram.Socket> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  return socket;
}

async function fakeBackend(): Promise<IFakeBackend> {
  const ack = await bindLocal();
  const users = await bindLocal();
  const next = (socket: dgram.Socket, timeoutMs = 500): Promise<Buffer | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => { socket.off('message', onMessage); resolve(null); }, timeoutMs);
      const onMessage = (msg: Buffer): void => { clearTimeout(timer); socket.off('message', onMessage); resolve(msg); };
      socket.on('message', onMessage);
    });
  return { ack, users, next, close: () => { ack.close(); users.close(); } };
}

describe('HandshakeHandler over real UDP sockets', () => {
  let backend: IFakeBackend;
  let plc: HandshakeHandler;
  let persisted = 0;

  const sendTo = (port: number, data: Buffer): void => { backend.ack.send(data, port, '127.0.0.1'); };

  beforeEach(async () => {
    resetState();
    persisted = 0;
    backend = await fakeBackend();
    plc = new HandshakeHandler({
      listenAck: 0,
      listenUsers: 0,
      listenJobs: 0,
      targetAckPort: backend.ack.address().port,
      targetUsersPort: backend.users.address().port,
      persist: () => { persisted++; },
    });
    await plc.start();
  });

  afterEach(() => {
    plc.stop();
    backend.close();
  });

  it('answers a 9092 READ like the real PLC: ACK on the users byte, then the 1104-byte table', async () => {
    const ackPromise = backend.next(backend.ack);
    const dataPromise = backend.next(backend.users);
    sendTo(plc.ports().ack, frame(IDLE, REQUEST_READ));

    expect([...((await ackPromise) ?? [])]).toEqual([IDLE, ACK]);
    const data = await dataPromise;
    expect(data?.length).toBe(1104);
    expect(parseUserData(data!)).toEqual(getState().users);
  });

  it('stores a 9092 WRITE and ACKs only after the data has arrived', async () => {
    sendTo(plc.ports().ack, frame(IDLE, REQUEST_WRITE));
    expect(await backend.next(backend.ack, 150)).toBeNull();

    const users: IRfidUser[] = getState().users.map((u, i) =>
      i === 0 ? { ...u, name: 'operatore-sim', group: RfidUserGroup.MAINTENANCE, enabled: true } : u,
    );
    const ackPromise = backend.next(backend.ack);
    sendTo(plc.ports().users, buildUserDataPacket(users));

    expect([...((await ackPromise) ?? [])]).toEqual([IDLE, ACK]);
    expect(getState().users[0]).toMatchObject({ name: 'operatore-sim', group: RfidUserGroup.MAINTENANCE, enabled: true });
    expect(persisted).toBe(1);
  });

  it('stores a 9090 job WRITE and ACKs on the jobs byte', async () => {
    const job: IJobData = { ...getState().job, supervisor: 'sup-sim', orderNumber: 'ORD-SIM-1', serialNumber: 'SN-SIM-1' };
    sendTo(plc.ports().ack, frame(REQUEST_WRITE, IDLE));
    const ackPromise = backend.next(backend.ack);
    sendTo(plc.ports().jobs, buildJobWritePacket(job));

    expect([...((await ackPromise) ?? [])]).toEqual([ACK, IDLE]);
    expect(getState().job).toEqual(job);
  });

  it('does not answer the backend release frames', async () => {
    sendTo(plc.ports().ack, frame(IDLE, ACK));
    sendTo(plc.ports().ack, frame(IDLE, IDLE));
    expect(await backend.next(backend.ack, 150)).toBeNull();
  });

  it('faultDropAck: sends nothing, so the backend handshake times out', async () => {
    updateState({ handshake: { faultDropAck: true } });
    const dataPromise = backend.next(backend.users, 200);
    sendTo(plc.ports().ack, frame(IDLE, REQUEST_READ));
    expect(await backend.next(backend.ack, 200)).toBeNull();
    expect(await dataPromise).toBeNull();
  });

  it('faultWrongState: answers 50 instead of ACK(100)', async () => {
    updateState({ handshake: { faultWrongState: true } });
    const ackPromise = backend.next(backend.ack);
    sendTo(plc.ports().ack, frame(IDLE, REQUEST_READ));
    expect([...((await ackPromise) ?? [])]).toEqual([IDLE, 50]);
  });
});
