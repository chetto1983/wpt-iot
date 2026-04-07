import { describe, it, expect, beforeEach } from 'vitest';
import { HandshakeState, RfidUserGroup, CycleType, RemoteJobEnable, MaintenanceRequest, RemoteCycleSelection } from '@wpt/types';
import { processControlMessage, parseUserDataBuffer, parseJobDataBuffer } from '../udp/handshakeHandler.js';
import { getState, resetState, updateState } from '../state/simulatorState.js';

describe('handshake FSM', () => {
  beforeEach(() => {
    resetState();
  });

  describe('9092 channel (user data) - read request', () => {
    it('on receiving byte[1]=255 (REQUEST_READ on 9092 channel), transitions port9092State to ACK', () => {
      // Byte[0]=2 (idle for 9090), byte[1]=255 (read request for 9092)
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.port9092StateTransition).toBe(HandshakeState.ACK);
    });

    it('on read request for 9092, action includes sendUserData', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.sendUserData).toBe(true);
    });
  });

  describe('9090 channel (job data) - read request', () => {
    it('on receiving byte[0]=255 (REQUEST_READ on 9090 channel), transitions port9090State to ACK', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 0);
      msg.writeUInt8(HandshakeState.IDLE, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.port9090StateTransition).toBe(HandshakeState.ACK);
    });

    it('on read request for 9090, action includes sendJobData', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 0);
      msg.writeUInt8(HandshakeState.IDLE, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.sendJobData).toBe(true);
    });
  });

  describe('9092 channel - write request', () => {
    it('on receiving byte[1]=254 (REQUEST_WRITE on 9092 channel), transitions port9092State to ACK', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_WRITE, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.port9092StateTransition).toBe(HandshakeState.ACK);
    });

    it('on write request for 9092, action includes awaitUserData', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_WRITE, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.awaitUserData).toBe(true);
    });
  });

  describe('9090 channel - write request', () => {
    it('on receiving byte[0]=254 (REQUEST_WRITE on 9090 channel), transitions port9090State to ACK', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.REQUEST_WRITE, 0);
      msg.writeUInt8(HandshakeState.IDLE, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.port9090StateTransition).toBe(HandshakeState.ACK);
    });

    it('on write request for 9090, action includes awaitJobData', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.REQUEST_WRITE, 0);
      msg.writeUInt8(HandshakeState.IDLE, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.awaitJobData).toBe(true);
    });
  });

  describe('return to IDLE', () => {
    it('after ACK, actions include returnToIdle', () => {
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.returnToIdle).toBe(true);
      expect(actions.port9092FinalState).toBe(HandshakeState.IDLE);
    });
  });

  describe('fault injection', () => {
    it('when faultDropAck=true, handler does NOT send ACK (skipAck=true)', () => {
      updateState({ handshake: { faultDropAck: true } });
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.skipAck).toBe(true);
    });

    it('when faultWrongState=true, handler sends incorrect state byte', () => {
      updateState({ handshake: { faultWrongState: true } });
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.wrongAckValue).toBe(true);
      expect(actions.port9092StateTransition).not.toBe(HandshakeState.ACK);
    });

    it('when ackDelayMs > 0, actions include delay value', () => {
      updateState({ handshake: { ackDelayMs: 500 } });
      const msg = Buffer.alloc(2);
      msg.writeUInt8(HandshakeState.IDLE, 0);
      msg.writeUInt8(HandshakeState.REQUEST_READ, 1);

      const actions = processControlMessage(msg, getState());
      expect(actions.delayMs).toBe(500);
    });
  });

  describe('parseUserDataBuffer', () => {
    it('parses a 1056-byte buffer back into user data', () => {
      const buf = Buffer.alloc(1056);
      // Write first user name
      buf.write('Test User', 0, 20, 'ascii');
      // Write first group = Admin (2)
      buf.writeUInt8(2, 960);
      // Write first enabled = enabled (0)
      buf.writeUInt8(0, 1008);
      // Write second enabled = disabled (1)
      buf.writeUInt8(1, 1009);

      const users = parseUserDataBuffer(buf);
      expect(users.length).toBe(48);
      expect(users[0]!.name).toBe('Test User');
      expect(users[0]!.group).toBe(RfidUserGroup.ADMIN);
      expect(users[0]!.enabled).toBe(true);
      expect(users[1]!.enabled).toBe(false);
    });

    it('preserves RFID enable polarity: byte 0 -> enabled=true, byte 1 -> enabled=false (PROT-V03-07)', () => {
      const buf = Buffer.alloc(1056);
      buf.write('UserEnabled', 0, 20, 'ascii');
      buf.write('UserDisabled', 20, 20, 'ascii');
      buf.writeUInt8(0, 1008);  // tag 1 -> enabled (byte 0)
      buf.writeUInt8(1, 1009);  // tag 2 -> disabled (byte 1)
      const users = parseUserDataBuffer(buf);
      expect(users[0]!.enabled).toBe(true);   // byte 0 means enabled
      expect(users[1]!.enabled).toBe(false);  // byte 1 means disabled
    });
  });

  describe('parseJobDataBuffer', () => {
    it('parses a 92-byte V03 buffer back into job data with all 9 fields', () => {
      const buf = Buffer.alloc(92);
      buf.write('Supervisor A', 0, 20, 'ascii');
      buf.write('ORD-123', 20, 20, 'ascii');
      buf.write('SER-456', 40, 20, 'ascii');
      buf.writeInt16BE(RemoteJobEnable.NEW_CYCLE_JOB_ENTRY, 80);
      buf.writeInt16BE(MaintenanceRequest.NO_REQUEST, 82);
      buf.writeInt16BE(RemoteCycleSelection.WAITING_FOR_REMOTE_CYCLE, 84);
      buf.writeInt16BE(CycleType.HOSPITAL, 86);

      const job = parseJobDataBuffer(buf);
      expect(job.supervisor).toBe('Supervisor A');
      expect(job.orderNumber).toBe('ORD-123');
      expect(job.serialNumber).toBe('SER-456');
      expect(job.remoteJobEnable).toBe(RemoteJobEnable.NEW_CYCLE_JOB_ENTRY);
      expect(job.maintenanceRequest).toBe(MaintenanceRequest.NO_REQUEST);
      expect(job.remoteCycleSelection).toBe(RemoteCycleSelection.WAITING_FOR_REMOTE_CYCLE);
      expect(job.cycleType).toBe(CycleType.HOSPITAL);
      buf.writeInt16BE(99, 88);  // spareInt02
      buf.writeInt16BE(88, 90);  // spareInt03
      const job2 = parseJobDataBuffer(buf);
      expect(job2.spareInt02).toBe(99);
      expect(job2.spareInt03).toBe(88);
    });
  });
});
