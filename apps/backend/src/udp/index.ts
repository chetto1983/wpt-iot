import type { FastifyBaseLogger } from 'fastify';
import { createSockets, bindSockets, closeSockets } from './sockets.js';
import { startMachineListener } from './machineListener.js';
import { startAlarmListener, seedAlarmState } from './alarmListener.js';
import { initHandshakeFsms, resetHandshakeChannel } from './handshakeFsm.js';
import { startMachineStore } from '../persistence/machineStore.js';
import { startAlarmStore, getActiveAlarmIndices } from '../persistence/alarmStore.js';

/**
 * Start the complete UDP pipeline:
 * 1. Create and bind 4 singleton UDP sockets
 * 2. Seed alarm state from DB (D-01: prevents false activations on restart)
 * 3. Start persistence subscribers (machine + alarm stores)
 * 4. Start machine and alarm listeners
 * 5. Initialize handshake FSMs and reset channels (Pitfall 5: crash recovery)
 * 6. Register graceful shutdown handlers
 */
export async function startUdpPipeline(log: FastifyBaseLogger): Promise<void> {
  // 1. Create and bind sockets (UDP-09)
  const sockets = createSockets();
  await bindSockets(sockets);
  log.info({ name: 'UdpPipeline' }, 'All UDP sockets bound');

  // 2. Seed alarm state from DB (D-01)
  try {
    const activeIndices = await getActiveAlarmIndices();
    await seedAlarmState(activeIndices);
    log.info({ name: 'UdpPipeline', activeAlarms: activeIndices.length }, 'Alarm state seeded from DB');
  } catch (err) {
    log.warn({ name: 'UdpPipeline', err: (err as Error).message }, 'Failed to seed alarm state from DB, starting with empty state');
  }

  // 3. Start persistence subscribers
  startMachineStore(log);
  startAlarmStore(log);

  // 4. Start listeners
  startMachineListener(sockets, log);
  startAlarmListener(sockets, log);
  log.info({ name: 'UdpPipeline' }, 'Machine and alarm listeners started');

  // 5. Initialize handshake FSMs and reset channels
  initHandshakeFsms();
  try {
    await resetHandshakeChannel(sockets.ackSocket);
    log.info({ name: 'UdpPipeline' }, 'Handshake channels reset to IDLE');
  } catch (err) {
    log.warn({ name: 'UdpPipeline', err: (err as Error).message }, 'Failed to reset handshake channels (simulator may not be running)');
  }

  // 6. Register graceful shutdown (UDP-09)
  setupGracefulShutdown(log);

  log.info({ name: 'UdpPipeline' }, 'UDP pipeline fully started');
}

/** Stop the pipeline and close sockets */
export function stopUdpPipeline(log: FastifyBaseLogger): void {
  closeSockets();
  log.info({ name: 'UdpPipeline' }, 'UDP pipeline stopped');
}

function setupGracefulShutdown(log: FastifyBaseLogger): void {
  const shutdown = (): void => {
    log.info({ name: 'Shutdown' }, 'Closing UDP sockets');
    closeSockets();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
