import { buildServer } from './server.js';
import { config } from './config.js';
import { startBroadcasting, stopBroadcasting } from './udp/broadcaster.js';
import { HandshakeHandler } from './udp/handshakeHandler.js';
import { loadPersistedState } from './persistence/jsonStore.js';
import { updateState, setOnExternalUpdate } from './state/simulatorState.js';
import { cycleEngine } from './state/cycleEngine.js';

async function main(): Promise<void> {
  // Load persisted state if exists
  const persisted = loadPersistedState(config.STATE_FILE_PATH);
  if (persisted) {
    updateState(persisted);
    console.log('Loaded persisted state from', config.STATE_FILE_PATH);
  }

  // Wire external update callback: manual state changes pause auto-cycle
  setOnExternalUpdate(() => {
    cycleEngine.pause();
  });

  // Start Fastify server
  const server = await buildServer();
  await server.listen({ port: config.SIM_PORT, host: '0.0.0.0' });

  // Start UDP broadcasting
  startBroadcasting();
  console.log('[Simulator] Auto-cycle engine started — machine will progress through 9 stages');

  // Start handshake handler
  const handshake = new HandshakeHandler();
  handshake.start();

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    server.log.info('Shutting down...');
    stopBroadcasting();
    handshake.stop();
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
