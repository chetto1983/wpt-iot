import type { ISocketManager } from './sockets.js';
import { parseMachineData } from './parsers.js';
import { MACHINE_PACKET_SIZE } from './packetSizes.js';
import { dataHub } from '../events/hub.js';
import { latestState } from '../cache/latestState.js';
import { MachineSnapshotSchema } from '@wpt/types';

/** Minimal logger interface compatible with Pino/Fastify logger */
export interface ILogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Attach a message handler to the data socket (port 9090) that:
 * 1. Validates packet size (D-11)
 * 2. Parses binary data into IMachineSnapshot
 * 3. Validates with Zod schema (D-11)
 * 4. Updates in-memory cache (D-09)
 * 5. Emits machine:data event to hub (D-08)
 */
export function startMachineListener(sockets: ISocketManager, log: ILogger): void {
  sockets.dataSocket.on('message', (msg: Buffer, rinfo) => {
    // D-11: Validate packet size, log and drop malformed
    if (msg.length < MACHINE_PACKET_SIZE) {
      log.warn(
        { name: 'MachineListener', size: msg.length, expected: MACHINE_PACKET_SIZE, from: `${rinfo.address}:${rinfo.port}` },
        'Malformed machine data packet (too short), dropping',
      );
      return;
    }

    try {
      const snapshot = parseMachineData(msg);

      // Validate with Zod (D-11)
      const result = MachineSnapshotSchema.safeParse(snapshot);
      if (!result.success) {
        log.warn(
          { name: 'MachineListener', errors: result.error.issues, from: `${rinfo.address}:${rinfo.port}` },
          'Machine data validation failed, dropping',
        );
        return;
      }

      const timestamp = new Date();

      // Update in-memory cache (D-09)
      latestState.setMachineSnapshot(snapshot, timestamp);

      // Emit to hub (D-08) -- persistence and future WebSocket subscribe here
      dataHub.emitMachineData(snapshot, timestamp);

      log.info(
        { name: 'MachineListener' },
        `Machine data received from ${rinfo.address}:${rinfo.port}`,
      );
    } catch (err) {
      log.warn(
        { name: 'MachineListener', err: (err as Error).message, from: `${rinfo.address}:${rinfo.port}`, hex: msg.subarray(0, 16).toString('hex') },
        'Failed to parse machine data, dropping',
      );
    }
  });
}
