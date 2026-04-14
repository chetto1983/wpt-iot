import type { WsMessageType } from './enums.js';

/** WebSocket message envelope (D-05) */
export interface IWsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  timestamp: string; // ISO 8601
}

/** Active alarm in the pushed alarm list (D-06) */
export interface IActiveAlarm {
  alarmIndex: number;
  wordIndex: number;
  bitIndex: number;
  active: true;
  descriptionIt: string;
  descriptionEn: string;
  activatedAt: string; // ISO 8601
}

/** PLC liveness signal pushed on state transitions and on client connect */
export interface IPlcStatus {
  connected: boolean;
  lastPacketAt: string | null; // ISO 8601 or null
}
