import { HandshakeState } from './enums.js';

/** UDP port configuration (default ports from .env.example) */
export interface IUdpPortConfig {
  data: number;     // 9090
  alarms: number;   // 9091
  users: number;    // 9092
  ack: number;      // 9093
}

/**
 * Control bytes for the handshake protocol.
 * From Mappatura AC500->IOT_9093: S4_9090_SEND_CTRL, S4_9092_SEND_CTRL
 * From Mappatura IOT->AC500_9093: R4_9090_REC_CTRL, R4_9092_REC_CTRL
 */
export interface IControlByte {
  port9090: HandshakeState;
  port9092: HandshakeState;
}

/** Metadata attached to incoming UDP packets */
export interface IUdpPacketMeta {
  sourcePort: number;
  sourceAddress: string;
  receivedAt: Date;
  size: number;
}
