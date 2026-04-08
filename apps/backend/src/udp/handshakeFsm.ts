import type dgram from 'node:dgram';
import { HandshakeState } from '@wpt/types';
import type { IRfidUser, IJobData } from '@wpt/types';
import { parseUserData, parseJobData, buildUserWritePacket, buildJobWritePacket } from './parsers.js';
import { USER_DATA_PACKET_SIZE, JOB_DATA_PACKET_SIZE } from './packetSizes.js';
import { config } from '../config.js';
import { getCachedPlcConfig } from './plcConfigService.js';

/** Configuration for a single HandshakeFSM instance */
export interface IFsmConfig {
  channelName: string;         // 'users' or 'jobs'
  controlByteIndex: number;    // 0 for jobs (port 9090 byte), 1 for users (port 9092 byte)
  simTargetDataPort: number;   // Where to send data TO simulator (19092 for users, 19090 for jobs)
  expectedDataSize: number;    // 1056 for users, 88 for jobs
  watchdogMs: number;          // 5000
}

/** Minimal structured logger accepted by HandshakeFSM methods */
interface IFsmLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * HandshakeFSM implements the bidirectional handshake protocol for one channel.
 *
 * Protocol (read):
 *   IoT sends REQUEST_READ(255) on port 9093 -> PLC responds ACK(100) on 9093
 *   -> PLC sends data on data port -> IoT sends IDLE(2) on 9093
 *
 * Protocol (write):
 *   IoT sends REQUEST_WRITE(254) on port 9093 -> PLC responds ACK(100) on 9093
 *   -> IoT sends data to PLC data port -> IoT sends IDLE(2) on 9093
 *
 * Two instances exist: one for users (controlByteIndex=1, port 9092)
 * and one for jobs (controlByteIndex=0, port 9090). They share the ACK
 * socket (port 9093) but each manages its own state, timer, and mutex.
 */
export class HandshakeFSM {
  private state: HandshakeState = HandshakeState.IDLE;
  private busy = false;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fsmConfig: IFsmConfig;

  constructor(fsmConfig: IFsmConfig) {
    this.fsmConfig = fsmConfig;
  }

  /** Build a 2-byte control message with this channel's byte set, other byte = IDLE */
  private buildControlMsg(value: HandshakeState): Buffer {
    const buf = Buffer.alloc(2);
    buf.writeUInt8(HandshakeState.IDLE, 0);
    buf.writeUInt8(HandshakeState.IDLE, 1);
    buf.writeUInt8(value, this.fsmConfig.controlByteIndex);
    return buf;
  }

  /**
   * Send a control message to the PLC's ACK port via the ackSocket.
   * Target host comes from the DB-backed `plc_config` cache so operators
   * can change it from the frontend without restarting the backend.
   */
  private async sendControl(ackSocket: dgram.Socket, value: HandshakeState): Promise<void> {
    const { targetHost } = await getCachedPlcConfig();
    return new Promise((resolve, reject) => {
      const msg = this.buildControlMsg(value);
      ackSocket.send(msg, 0, 2, config.simAckPort, targetHost, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Read data from PLC via handshake protocol.
   *
   * REAL PLC behavior (verified 2026-04-08 on ABB AC500 @ 192.168.0.10 via
   * tcpdump, .planning/debug/artifacts/rfid-read-9092-9093-2026-04-08.pcap):
   *
   *   1. Backend 9093 → PLC 9093: 2B payload [9090ch=IDLE(2), 9092ch=REQUEST_READ(255)]
   *   2. PLC 9093 → Backend 9093: 2B payload [9090ch=IDLE(2), 9092ch=ACK(100)] — 44 ms later
   *   3. PLC 9092 → Backend 9092: full data packet — 10 ms after the ACK (54 ms after step 1)
   *   4. Backend 9093 → PLC 9093: 2B payload [IDLE, IDLE] cleanup
   *   5. PLC 9093 → Backend 9093: 2B payload [IDLE, IDLE] — PLC echoes the cleanup state
   *
   * The PLC DOES send ACK(100) on 9093, contrary to an earlier claim in this
   * file. The earlier "PLC never ACKs" observation (7 tcpdump captures showing
   * zero PLC→VM 9093 traffic) was a RACE CONDITION artifact: the previous
   * waitForAck() set up its listener AFTER sendControl(REQUEST_READ) returned,
   * so the ACK — which arrives within ~44 ms — raced past the unattached
   * listener. The ACK was real; the listener wasn't ready.
   *
   * Sequence (current implementation):
   *   1. Attach data listener on dataSocket BEFORE sending REQUEST_READ — closes
   *      the original race window on the data path.
   *   2. Send REQUEST_READ(255) on ack port (9093) on this channel's byte.
   *   3. Await the data packet on the data port. The ACK that arrives on 9093
   *      ~10 ms before the data is correct but ignored — a stricter
   *      implementation could consume it for faster failure detection, but
   *      that's an optimization, not a correctness requirement.
   *   4. Send IDLE(2) on ack port as cleanup.
   *
   * NOTE: this path intentionally skips waitForAck. Not because the PLC doesn't
   * ACK (it does — see wire capture), but because we only need the data to
   * consider the read successful, and ignoring the ACK simplifies the FSM.
   */
  async read(
    ackSocket: dgram.Socket,
    dataSocket: dgram.Socket,
    log: IFsmLogger,
  ): Promise<Buffer> {
    if (this.busy) {
      throw new Error(`Handshake in progress on ${this.fsmConfig.channelName}`);
    }
    this.busy = true;
    this.state = HandshakeState.REQUEST_READ;

    try {
      // Attach data listener FIRST — the real PLC responds within ~50 ms, so
      // we must be listening on dataSocket when we send REQUEST_READ. The
      // waitForData Promise registers its listener synchronously in its
      // executor, so by the time this assignment returns the listener is live.
      const dataPromise = this.waitForData(dataSocket, log);

      // Now send REQUEST_READ on ack port (9093), this channel's byte.
      await this.sendControl(ackSocket, HandshakeState.REQUEST_READ);
      log.info({ name: 'HandshakeFSM', channel: this.fsmConfig.channelName }, 'Sent REQUEST_READ');

      // Await the data that the PLC pushes on dataSocket.
      const data = await dataPromise;

      // Send IDLE to reset the channel state (best effort).
      await this.sendControl(ackSocket, HandshakeState.IDLE);
      this.state = HandshakeState.IDLE;

      return data;
    } catch (err) {
      // Reset to IDLE on any error
      this.state = HandshakeState.IDLE;
      try { await this.sendControl(ackSocket, HandshakeState.IDLE); } catch { /* best effort */ }
      throw err;
    } finally {
      this.busy = false;
      this.clearWatchdog();
    }
  }

  /**
   * Write data to PLC via handshake protocol (fire-and-forget).
   *
   * Sequence:
   *   1. Send REQUEST_WRITE(254) on ack port (9093) on this channel's byte.
   *   2. Send the data buffer on the data port.
   *   3. Send IDLE(2) on ack port as cleanup.
   *
   * Legacy V01 code (SC_Complete_wpt-40-local-server) establishes the pattern:
   * sendUsers9092 / sendData9090 send control → data → control(reset) without
   * waiting for a write-side ACK. We mirror that pattern here.
   *
   * Note: whether the real PLC sends an ACK(100) on 9093 after a REQUEST_WRITE
   * has NOT been captured as of 2026-04-08 — only the READ path has wire
   * evidence (where the PLC does ACK, see read() docstring). The WRITE path
   * treats the exchange as fire-and-forget regardless, so ACK presence or
   * absence doesn't affect correctness. Bench-day follow-up: capture a 9093
   * frame after a /rfid/write or /jobs/write to close this question.
   */
  async write(
    ackSocket: dgram.Socket,
    dataSocket: dgram.Socket,
    data: Buffer,
    log: IFsmLogger,
  ): Promise<void> {
    if (this.busy) {
      throw new Error(`Handshake in progress on ${this.fsmConfig.channelName}`);
    }
    this.busy = true;
    this.state = HandshakeState.REQUEST_WRITE;

    try {
      // Send REQUEST_WRITE on ack port (9093), this channel's byte.
      await this.sendControl(ackSocket, HandshakeState.REQUEST_WRITE);
      log.info({ name: 'HandshakeFSM', channel: this.fsmConfig.channelName }, 'Sent REQUEST_WRITE');

      // Send data to PLC's data port using DB-backed target host.
      const { targetHost } = await getCachedPlcConfig();
      await new Promise<void>((resolve, reject) => {
        dataSocket.send(data, 0, data.length, this.fsmConfig.simTargetDataPort, targetHost, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      log.info({ name: 'HandshakeFSM', channel: this.fsmConfig.channelName, bytes: data.length }, 'Data sent');

      // Send IDLE to reset the channel state (best effort).
      await this.sendControl(ackSocket, HandshakeState.IDLE);
      this.state = HandshakeState.IDLE;
    } catch (err) {
      this.state = HandshakeState.IDLE;
      try { await this.sendControl(ackSocket, HandshakeState.IDLE); } catch { /* best effort */ }
      throw err;
    } finally {
      this.busy = false;
      this.clearWatchdog();
    }
  }

  /**
   * Wait for data packet on the data socket, with watchdog timeout.
   *
   * NOTE: waitForAck was removed 2026-04-08 because it was racy — it attached
   * its 9093 listener AFTER sendControl(REQUEST_READ) returned, so the real
   * PLC's ACK(100) response (which arrives within ~44 ms — see read() for the
   * wire capture) raced past the unattached listener and every read timed out.
   * The read() path now attaches THIS data listener BEFORE sending REQUEST_READ,
   * so the ~54 ms data response is caught without needing to observe the ACK
   * at all. The write() path is fire-and-forget and doesn't use this.
   */
  private waitForData(dataSocket: dgram.Socket, log: IFsmLogger): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const onMessage = (msg: Buffer): void => {
        if (msg.length >= this.fsmConfig.expectedDataSize) {
          cleanup();
          resolve(msg);
        }
      };

      const onTimeout = (): void => {
        cleanup();
        log.warn({ name: 'HandshakeFSM', channel: this.fsmConfig.channelName }, 'Watchdog timeout waiting for data');
        reject(new Error(`Handshake timeout on ${this.fsmConfig.channelName}: no data within ${this.fsmConfig.watchdogMs}ms`));
      };

      const cleanup = (): void => {
        dataSocket.removeListener('message', onMessage);
        this.clearWatchdog();
      };

      dataSocket.on('message', onMessage);
      this.watchdogTimer = setTimeout(onTimeout, this.fsmConfig.watchdogMs);
    });
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Force-reset the channel to IDLE (Pitfall 5: recovery after crash) */
  async resetChannel(ackSocket: dgram.Socket): Promise<void> {
    await this.sendControl(ackSocket, HandshakeState.IDLE);
    this.state = HandshakeState.IDLE;
    this.busy = false;
    this.clearWatchdog();
  }

  getState(): HandshakeState { return this.state; }
  isBusy(): boolean { return this.busy; }
}

// ---------------------------------------------------------------------------
// Singleton instances and convenience functions (D-04, D-07)
// ---------------------------------------------------------------------------

/** Two singleton FSM instances: one for users, one for jobs */
let usersFsm: HandshakeFSM | null = null;
let jobsFsm: HandshakeFSM | null = null;

/** Initialize both FSM instances. Call once at startup. */
export function initHandshakeFsms(): { usersFsm: HandshakeFSM; jobsFsm: HandshakeFSM } {
  usersFsm = new HandshakeFSM({
    channelName: 'users',
    controlByteIndex: 1,                         // Byte 1 = port 9092 control
    simTargetDataPort: config.simUsersPort,       // 19092
    expectedDataSize: USER_DATA_PACKET_SIZE,      // 1056
    watchdogMs: config.handshakeTimeoutMs,        // 5000
  });
  jobsFsm = new HandshakeFSM({
    channelName: 'jobs',
    controlByteIndex: 0,                          // Byte 0 = port 9090 control
    simTargetDataPort: config.simDataPort,        // 19090
    expectedDataSize: JOB_DATA_PACKET_SIZE,       // 88
    watchdogMs: config.handshakeTimeoutMs,        // 5000
  });
  return { usersFsm, jobsFsm };
}

function getFsms(): { usersFsm: HandshakeFSM; jobsFsm: HandshakeFSM } {
  if (!usersFsm || !jobsFsm) throw new Error('HandshakeFSMs not initialized');
  return { usersFsm, jobsFsm };
}

/** Read RFID users from PLC (D-07: internal method, no HTTP route yet) */
export async function readUsers(
  ackSocket: dgram.Socket,
  dataSocket: dgram.Socket,
  log: IFsmLogger,
): Promise<IRfidUser[]> {
  const { usersFsm: fsm } = getFsms();
  const buf = await fsm.read(ackSocket, dataSocket, log);
  return parseUserData(buf);
}

/** Write RFID users to PLC */
export async function writeUsers(
  ackSocket: dgram.Socket,
  dataSocket: dgram.Socket,
  users: IRfidUser[],
  log: IFsmLogger,
): Promise<void> {
  const { usersFsm: fsm } = getFsms();
  const packet = buildUserWritePacket(users);
  await fsm.write(ackSocket, dataSocket, packet, log);
}

/** Read job data from PLC */
export async function readJob(
  ackSocket: dgram.Socket,
  dataSocket: dgram.Socket,
  log: IFsmLogger,
): Promise<IJobData> {
  const { jobsFsm: fsm } = getFsms();
  const buf = await fsm.read(ackSocket, dataSocket, log);
  return parseJobData(buf);
}

/** Write job data to PLC (UDP-10) */
export async function writeJob(
  ackSocket: dgram.Socket,
  dataSocket: dgram.Socket,
  job: IJobData,
  log: IFsmLogger,
): Promise<void> {
  const { jobsFsm: fsm } = getFsms();
  const packet = buildJobWritePacket(job);
  await fsm.write(ackSocket, dataSocket, packet, log);
}

/** Reset both channels to IDLE on startup (Pitfall 5) */
export async function resetHandshakeChannel(ackSocket: dgram.Socket): Promise<void> {
  const { usersFsm: uFsm, jobsFsm: jFsm } = getFsms();
  await uFsm.resetChannel(ackSocket);
  await jFsm.resetChannel(ackSocket);
}
