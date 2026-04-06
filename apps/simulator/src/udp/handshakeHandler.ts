import dgram from 'node:dgram';
import { HandshakeState } from '@wpt/types';
import type { IRfidUser, IJobData , RfidUserGroup } from '@wpt/types';
import { getState, updateState, type ISimulatorState } from '../state/simulatorState.js';
import { buildUserDataPacket, buildJobReadPacket } from './packetBuilder.js';
import { savePersistedState } from '../persistence/jsonStore.js';
import { config } from '../config.js';

/** Wrong ACK value used for fault injection */
const WRONG_ACK_VALUE = 50;

/**
 * Actions returned by processControlMessage for testability.
 * The actual UDP sends are handled by HandshakeHandler based on these actions.
 */
export interface IHandshakeActions {
  port9090StateTransition?: HandshakeState;
  port9092StateTransition?: HandshakeState;
  port9090FinalState?: HandshakeState;
  port9092FinalState?: HandshakeState;
  sendUserData: boolean;
  sendJobData: boolean;
  awaitUserData: boolean;
  awaitJobData: boolean;
  returnToIdle: boolean;
  skipAck: boolean;
  wrongAckValue: boolean;
  delayMs: number;
  ackByte9090: number;
  ackByte9092: number;
}

/**
 * Pure function: process a 2-byte control message and return the actions to take.
 * This is the testable FSM logic extracted from the socket handler.
 */
export function processControlMessage(msg: Buffer, state: ISimulatorState): IHandshakeActions {
  const ctrl9090 = msg.readUInt8(0);
  const ctrl9092 = msg.readUInt8(1);

  const actions: IHandshakeActions = {
    sendUserData: false,
    sendJobData: false,
    awaitUserData: false,
    awaitJobData: false,
    returnToIdle: false,
    skipAck: state.handshake.faultDropAck,
    wrongAckValue: state.handshake.faultWrongState,
    delayMs: state.handshake.ackDelayMs,
    ackByte9090: state.handshake.port9090State,
    ackByte9092: state.handshake.port9092State,
  };

  // Handle 9092 channel (user data)
  if (ctrl9092 === HandshakeState.REQUEST_READ) {
    if (state.handshake.faultWrongState) {
      actions.port9092StateTransition = WRONG_ACK_VALUE as HandshakeState;
      actions.ackByte9092 = WRONG_ACK_VALUE;
    } else {
      actions.port9092StateTransition = HandshakeState.ACK;
      actions.ackByte9092 = HandshakeState.ACK;
    }
    actions.sendUserData = true;
    actions.returnToIdle = true;
    actions.port9092FinalState = HandshakeState.IDLE;
  } else if (ctrl9092 === HandshakeState.REQUEST_WRITE) {
    if (state.handshake.faultWrongState) {
      actions.port9092StateTransition = WRONG_ACK_VALUE as HandshakeState;
      actions.ackByte9092 = WRONG_ACK_VALUE;
    } else {
      actions.port9092StateTransition = HandshakeState.ACK;
      actions.ackByte9092 = HandshakeState.ACK;
    }
    actions.awaitUserData = true;
    actions.returnToIdle = true;
    actions.port9092FinalState = HandshakeState.IDLE;
  }

  // Handle 9090 channel (job data)
  if (ctrl9090 === HandshakeState.REQUEST_READ) {
    if (state.handshake.faultWrongState) {
      actions.port9090StateTransition = WRONG_ACK_VALUE as HandshakeState;
      actions.ackByte9090 = WRONG_ACK_VALUE;
    } else {
      actions.port9090StateTransition = HandshakeState.ACK;
      actions.ackByte9090 = HandshakeState.ACK;
    }
    actions.sendJobData = true;
    actions.returnToIdle = true;
    actions.port9090FinalState = HandshakeState.IDLE;
  } else if (ctrl9090 === HandshakeState.REQUEST_WRITE) {
    if (state.handshake.faultWrongState) {
      actions.port9090StateTransition = WRONG_ACK_VALUE as HandshakeState;
      actions.ackByte9090 = WRONG_ACK_VALUE;
    } else {
      actions.port9090StateTransition = HandshakeState.ACK;
      actions.ackByte9090 = HandshakeState.ACK;
    }
    actions.awaitJobData = true;
    actions.returnToIdle = true;
    actions.port9090FinalState = HandshakeState.IDLE;
  }

  return actions;
}

/**
 * Parse a 1056-byte user data buffer back into IRfidUser array.
 * Used when receiving write data from the backend.
 */
export function parseUserDataBuffer(buf: Buffer): IRfidUser[] {
  const users: IRfidUser[] = [];
  for (let i = 0; i < 48; i++) {
    const name = buf.toString('ascii', i * 20, (i + 1) * 20).replace(/\0+$/, '');
    const group = buf.readUInt8(960 + i) as RfidUserGroup;
    const enabledByte = buf.readUInt8(1008 + i);
    users.push({
      tagId: i + 1,
      name,
      group,
      enabled: enabledByte === 0, // Inverted: 0=enabled, 1=disabled
    });
  }
  return users;
}

/**
 * Parse an 88-byte job data buffer back into IJobData.
 * Used when receiving write data from the backend.
 */
export function parseJobDataBuffer(buf: Buffer): IJobData {
  return {
    supervisor: buf.toString('ascii', 0, 20).replace(/\0+$/, ''),
    orderNumber: buf.toString('ascii', 20, 40).replace(/\0+$/, ''),
    serialNumber: buf.toString('ascii', 40, 60).replace(/\0+$/, ''),
    remoteJobEnable: buf.readInt16BE(80),
    maintenanceRequest: buf.readInt16BE(82),
    remoteCycleSelection: buf.readInt16BE(84),
    cycleType: buf.readInt16BE(86),
  };
}

/**
 * HandshakeHandler manages the full UDP handshake protocol from the PLC perspective.
 * It listens on port 9093 for control messages and orchestrates data exchange
 * on ports 9090 and 9092.
 */
export class HandshakeHandler {
  private ackSocket: dgram.Socket;
  private dataListenSocket: dgram.Socket;
  private usersListenSocket: dgram.Socket;
  private pendingUserWrite: ((buf: Buffer) => void) | null = null;
  private pendingJobWrite: ((buf: Buffer) => void) | null = null;

  constructor() {
    this.ackSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.dataListenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.usersListenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  }

  /** Start listening for handshake control messages on port 9093 */
  start(): void {
    // Listen on port 9093 for control messages
    this.ackSocket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      if (msg.length < 2) return;
      this.handleControlMessage(msg, rinfo);
    });
    this.ackSocket.bind(config.UDP_LISTEN_ACK);

    // Listen on port 9092 for incoming user write data
    this.usersListenSocket.on('message', (msg: Buffer) => {
      if (this.pendingUserWrite && msg.length >= 1056) {
        this.pendingUserWrite(msg);
        this.pendingUserWrite = null;
      }
    });
    this.usersListenSocket.bind(config.UDP_LISTEN_USERS);

    // Listen on port 9090 for incoming job write data
    this.dataListenSocket.on('message', (msg: Buffer) => {
      if (this.pendingJobWrite && msg.length >= 88) {
        this.pendingJobWrite(msg);
        this.pendingJobWrite = null;
      }
    });
    this.dataListenSocket.bind(config.UDP_LISTEN_DATA);

    console.log(`[HandshakeHandler] Listening on ports ${config.UDP_LISTEN_ACK} (ack), ${config.UDP_LISTEN_USERS} (users), ${config.UDP_LISTEN_DATA} (data)`);
  }

  /** Handle an incoming 2-byte control message */
  private handleControlMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const state = getState();
    const actions = processControlMessage(msg, state);
    const targetHost = rinfo.address;

    const execute = (): void => {
      // Skip ACK entirely if faultDropAck
      if (actions.skipAck) {
        console.log(`[HandshakeHandler] Fault: dropping ACK`);
        return;
      }

      // Send ACK on port 9093 to the BACKEND's ack listener (not our own).
      // In docker bridge mode UDP_LISTEN_ACK and TARGET_ACK_PORT happen to match;
      // in local Windows dev they MUST differ — only TARGET_ACK_PORT routes correctly.
      const ackBuf = Buffer.alloc(2);
      ackBuf.writeUInt8(actions.ackByte9090, 0);
      ackBuf.writeUInt8(actions.ackByte9092, 1);
      this.ackSocket.send(ackBuf, 0, 2, config.TARGET_ACK_PORT, targetHost);

      // Update state with ACK transition
      if (actions.port9090StateTransition !== undefined) {
        updateState({ handshake: { port9090State: actions.port9090StateTransition } });
      }
      if (actions.port9092StateTransition !== undefined) {
        updateState({ handshake: { port9092State: actions.port9092StateTransition } });
      }

      // Send data for read requests — destination is BACKEND's listening port,
      // not our own (UDP_LISTEN_*). Use TARGET_*_PORT so local Windows dev works
      // when sim listens on 19xxx and backend listens on 9xxx.
      if (actions.sendUserData) {
        const userPacket = buildUserDataPacket(getState().users);
        this.ackSocket.send(userPacket, 0, userPacket.length, config.TARGET_USERS_PORT, targetHost);
        console.log(`[HandshakeHandler] Sent user data (${userPacket.length} bytes)`);
      }

      if (actions.sendJobData) {
        const jobPacket = buildJobReadPacket(getState().job);
        this.ackSocket.send(jobPacket, 0, jobPacket.length, config.TARGET_DATA_PORT, targetHost);
        console.log(`[HandshakeHandler] Sent job data (${jobPacket.length} bytes)`);
      }

      // Await data for write requests
      if (actions.awaitUserData) {
        this.pendingUserWrite = (buf: Buffer) => {
          const users = parseUserDataBuffer(buf);
          updateState({ users });
          savePersistedState(config.STATE_FILE_PATH, getState());
          console.log(`[HandshakeHandler] Received and stored user data`);
        };
      }

      if (actions.awaitJobData) {
        this.pendingJobWrite = (buf: Buffer) => {
          const job = parseJobDataBuffer(buf);
          updateState({ job });
          savePersistedState(config.STATE_FILE_PATH, getState());
          console.log(`[HandshakeHandler] Received and stored job data`);
        };
      }

      // Return to IDLE after a short delay — send to BACKEND's ack listener
      // (TARGET_ACK_PORT) so the backend's FSM observes the cycle completing.
      if (actions.returnToIdle) {
        setTimeout(() => {
          const idleBuf = Buffer.alloc(2);
          idleBuf.writeUInt8(actions.port9090FinalState ?? state.handshake.port9090State, 0);
          idleBuf.writeUInt8(actions.port9092FinalState ?? state.handshake.port9092State, 1);
          this.ackSocket.send(idleBuf, 0, 2, config.TARGET_ACK_PORT, targetHost);

          if (actions.port9090FinalState !== undefined) {
            updateState({ handshake: { port9090State: actions.port9090FinalState } });
          }
          if (actions.port9092FinalState !== undefined) {
            updateState({ handshake: { port9092State: actions.port9092FinalState } });
          }
        }, 100);
      }
    };

    // Apply configurable delay before responding
    if (actions.delayMs > 0) {
      setTimeout(execute, actions.delayMs);
    } else {
      execute();
    }
  }

  /** Stop listening and close all sockets */
  stop(): void {
    try { this.ackSocket.close(); } catch { /* may already be closed */ }
    try { this.dataListenSocket.close(); } catch { /* may already be closed */ }
    try { this.usersListenSocket.close(); } catch { /* may already be closed */ }
    this.pendingUserWrite = null;
    this.pendingJobWrite = null;
    console.log(`[HandshakeHandler] Stopped`);
  }
}
