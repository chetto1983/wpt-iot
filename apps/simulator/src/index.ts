import { setPlcEndian } from '@wpt/types/plc-wire';
import { buildServer } from './server.js';
import { config } from './config.js';
import { startBroadcasting, stopBroadcasting } from './udp/broadcaster.js';
import { HandshakeHandler } from './udp/handshakeHandler.js';
import { loadPersistedState } from './persistence/jsonStore.js';
import { updateState, setOnExternalUpdate } from './state/simulatorState.js';
import { cycleEngine } from './state/cycleEngine.js';

async function main(): Promise<void> {
  setPlcEndian(config.PLC_ENDIAN);

  const persisted = loadPersistedState(config.STATE_FILE_PATH);
  if (persisted) {
    updateState(persisted);
    console.log('Loaded persisted state from', config.STATE_FILE_PATH);
  }

  // Manual state changes from the UI pause the auto-cycle.
  setOnExternalUpdate(() => {
    cycleEngine.pause();
  });

  const server = await buildServer();
  await server.listen({ port: config.SIM_PORT, host: '0.0.0.0' });

  const handshake = new HandshakeHandler();
  await handshake.start();
  startBroadcasting();
  console.log(`[Simulator] PLC ${config.PLC_ENDIAN.toUpperCase()} -> backend ${config.TARGET_HOST}`);

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

main().catch((err: unknown) => {
  console.error('[Simulator] Startup failed:', err);
  process.exit(1);
});
