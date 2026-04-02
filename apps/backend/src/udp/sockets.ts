import dgram from 'node:dgram';
import { config } from '../config.js';

/**
 * Singleton manager for the 4 UDP sockets used by the backend.
 * Per D-09: Created once at startup, closed on shutdown.
 */
export interface ISocketManager {
  dataSocket: dgram.Socket;     // Port 9090 - machine data + job handshake
  alarmSocket: dgram.Socket;    // Port 9091 - alarm data
  userSocket: dgram.Socket;     // Port 9092 - user data handshake
  ackSocket: dgram.Socket;      // Port 9093 - control messages
}

let sockets: ISocketManager | null = null;

/** Create all 4 UDP sockets with reuseAddr. Call once at startup. */
export function createSockets(): ISocketManager {
  if (sockets) return sockets;

  const dataSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const alarmSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const userSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const ackSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sockets = { dataSocket, alarmSocket, userSocket, ackSocket };
  return sockets;
}

/**
 * Bind all sockets to their configured ports.
 * Returns a Promise that resolves when all 4 sockets are bound.
 */
export async function bindSockets(mgr: ISocketManager): Promise<void> {
  const bind = (socket: dgram.Socket, port: number, name: string): Promise<void> =>
    new Promise((resolve, reject) => {
      socket.bind(port, config.udpAddress, () => {
        console.log(`[UDP] ${name} socket bound on ${config.udpAddress}:${port}`);
        resolve();
      });
      socket.on('error', (err) => {
        console.error(`[UDP] ${name} socket error: ${err.message}`);
        reject(err);
      });
    });

  await Promise.all([
    bind(mgr.dataSocket, config.udpPortData, 'Data/9090'),
    bind(mgr.alarmSocket, config.udpPortAlarms, 'Alarm/9091'),
    bind(mgr.userSocket, config.udpPortUsers, 'User/9092'),
    bind(mgr.ackSocket, config.udpPortAck, 'Ack/9093'),
  ]);
}

/** Get the singleton socket manager. Throws if createSockets() not called. */
export function getSockets(): ISocketManager {
  if (!sockets) throw new Error('UDP sockets not initialized. Call createSockets() first.');
  return sockets;
}

/** Close all sockets gracefully. Resets singleton for fresh creation. */
export function closeSockets(): void {
  if (!sockets) return;
  const names: (keyof ISocketManager)[] = ['dataSocket', 'alarmSocket', 'userSocket', 'ackSocket'];
  for (const name of names) {
    try { sockets[name].close(); } catch { /* already closed */ }
  }
  sockets = null;
}
