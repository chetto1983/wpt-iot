import dgram from 'node:dgram';
import { HandshakeState } from '@wpt/types';
import {
  JOB_DATA_PACKET_SIZE,
  USER_DATA_PACKET_SIZE,
  buildUserDataPacket,
  parseJobData,
  parseUserData,
} from '@wpt/types/plc-wire';
import { getState, updateState } from '../state/simulatorState.js';
import { savePersistedState } from '../persistence/jsonStore.js';
import { config } from '../config.js';

/** Byte index of each data channel in the 2-byte 9093 control frame. */
export enum Channel {
  Jobs = 0, // data port 9090
  Users = 1, // data port 9092
}

export type ControlAction =
  | { kind: 'read'; channel: Channel.Users }
  | { kind: 'armWrite'; channel: Channel };

// Real PLC timing on a 9092 read (2026-04-08 tcpdump): ACK(100) 44 ms after
// the REQUEST_READ, the data 10 ms after the ACK.
const PLC_ACK_LATENCY_MS = 44;
const PLC_DATA_AFTER_ACK_MS = 10;
/** Fault injection: a state byte the backend FSM does not expect. */
const WRONG_ACK_VALUE = 50;

const CHANNELS = [Channel.Jobs, Channel.Users] as const;

/**
 * What a 9093 control frame asks of the PLC. The backend's own release frames
 * (ACK, IDLE) ask nothing; a job REQUEST_READ is ignored because the real PLC
 * never sends job data back (job values ride the machine data broadcast).
 */
export function decodeControlFrame(msg: Buffer): ControlAction[] {
  const actions: ControlAction[] = [];
  for (const channel of CHANNELS) {
    const value = msg.readUInt8(channel);
    if (value === HandshakeState.REQUEST_WRITE) actions.push({ kind: 'armWrite', channel });
    else if (value === HandshakeState.REQUEST_READ && channel === Channel.Users) actions.push({ kind: 'read', channel });
  }
  return actions;
}

/** The PLC's answer frame: `value` on `channel`, IDLE on the other byte. */
export function buildAckFrame(channel: Channel, value: number): Buffer {
  const frame = Buffer.from([HandshakeState.IDLE, HandshakeState.IDLE]);
  frame.writeUInt8(value, channel);
  return frame;
}

export interface IHandshakePorts {
  listenAck: number;
  listenUsers: number;
  listenJobs: number;
  targetAckPort: number;
  targetUsersPort: number;
  persist: () => void;
}

const DEFAULT_PORTS: IHandshakePorts = {
  listenAck: config.UDP_LISTEN_ACK,
  listenUsers: config.UDP_LISTEN_USERS,
  listenJobs: config.UDP_LISTEN_DATA,
  targetAckPort: config.TARGET_ACK_PORT,
  targetUsersPort: config.TARGET_USERS_PORT,
  persist: () => savePersistedState(config.STATE_FILE_PATH, getState()),
};

/** The per-channel state byte shown in the simulator UI. */
function setChannelState(channel: Channel, value: number): void {
  const state = value as HandshakeState;
  updateState({ handshake: channel === Channel.Jobs ? { port9090State: state } : { port9092State: state } });
}

function bind(socket: dgram.Socket, port: number): Promise<void> {
  return new Promise((resolve) => socket.bind(port, resolve));
}

/** The PLC side of the 9093 handshake for the users (9092) and jobs (9090) channels. */
export class HandshakeHandler {
  private readonly ack = dgram.createSocket('udp4');
  private readonly users = dgram.createSocket('udp4');
  private readonly jobs = dgram.createSocket('udp4');
  /** Backend address per channel whose REQUEST_WRITE still awaits its data. */
  private readonly pendingWrite = new Map<Channel, string>();
  /** Scheduled responses; stop() cancels them so none fires into a closed socket. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly opts: IHandshakePorts = DEFAULT_PORTS) {}

  async start(): Promise<void> {
    this.ack.on('message', (msg, rinfo) => {
      if (msg.length >= 2) this.onControl(msg, rinfo.address);
    });
    this.users.on('message', (msg) => this.onWriteData(Channel.Users, msg));
    this.jobs.on('message', (msg) => this.onWriteData(Channel.Jobs, msg));
    await Promise.all([
      bind(this.ack, this.opts.listenAck),
      bind(this.users, this.opts.listenUsers),
      bind(this.jobs, this.opts.listenJobs),
    ]);
    const p = this.ports();
    console.log(`[HandshakeHandler] Listening on ${p.ack} (ack), ${p.users} (users), ${p.jobs} (jobs)`);
  }

  ports(): { ack: number; users: number; jobs: number } {
    return { ack: this.ack.address().port, users: this.users.address().port, jobs: this.jobs.address().port };
  }

  stop(): void {
    for (const socket of [this.ack, this.users, this.jobs]) {
      try { socket.close(); } catch { /* already closed */ }
    }
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.pendingWrite.clear();
  }

  private onControl(msg: Buffer, backendHost: string): void {
    for (const channel of CHANNELS) setChannelState(channel, msg.readUInt8(channel));
    for (const action of decodeControlFrame(msg)) {
      if (action.kind === 'armWrite') this.pendingWrite.set(action.channel, backendHost);
      else this.answerRead(backendHost);
    }
  }

  private answerRead(backendHost: string): void {
    this.afterLatency(() => {
      if (!this.sendAck(Channel.Users, backendHost)) return;
      this.schedule(PLC_DATA_AFTER_ACK_MS, () => {
        this.users.send(buildUserDataPacket(getState().users), this.opts.targetUsersPort, backendHost);
      });
    });
  }

  private onWriteData(channel: Channel, msg: Buffer): void {
    const backendHost = this.pendingWrite.get(channel);
    const minSize = channel === Channel.Users ? USER_DATA_PACKET_SIZE : JOB_DATA_PACKET_SIZE;
    if (backendHost === undefined || msg.length < minSize) return;
    this.pendingWrite.delete(channel);
    if (channel === Channel.Users) updateState({ users: parseUserData(msg) });
    else updateState({ job: parseJobData(msg) });
    this.opts.persist();
    console.log(`[HandshakeHandler] Stored ${Channel[channel]} write (${msg.length} bytes)`);
    this.afterLatency(() => this.sendAck(channel, backendHost));
  }

  /** False when the drop-ACK fault swallows the whole response. */
  private sendAck(channel: Channel, backendHost: string): boolean {
    const { faultDropAck, faultWrongState } = getState().handshake;
    if (faultDropAck) return false;
    const value = faultWrongState ? WRONG_ACK_VALUE : HandshakeState.ACK;
    this.ack.send(buildAckFrame(channel, value), this.opts.targetAckPort, backendHost);
    setChannelState(channel, value);
    return true;
  }

  private afterLatency(fn: () => void): void {
    this.schedule(PLC_ACK_LATENCY_MS + getState().handshake.ackDelayMs, fn);
  }

  private schedule(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }
}
