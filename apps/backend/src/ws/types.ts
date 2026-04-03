import type { WebSocket } from 'ws';
import type { UserRole } from '@wpt/types';

/** Internal WebSocket client tracked by the broadcaster */
export interface IWsClient {
  socket: WebSocket;
  role: UserRole;
  sessionId: string;
  heartbeatTimer: NodeJS.Timeout;
  pongTimeout: NodeJS.Timeout | null;
  alive: boolean;
}
