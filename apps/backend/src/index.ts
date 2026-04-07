import { buildServer } from './server.js';
import { config } from './config.js';
import { loadAlarmDescriptions } from './i18n/alarmDescriptions.js';
import { seedDefaultAdmin } from './auth/seed.js';
import { startUdpPipeline, stopUdpPipeline } from './udp/index.js';
import { initBroadcaster, shutdownBroadcaster } from './ws/broadcaster.js';
import { connectMqtt, disconnectMqtt } from './mqtt/connectionManager.js';
import { MqttConfigService } from './mqtt/configService.js';
import { pool } from './db/index.js';

function setupGracefulShutdown(server: ReturnType<typeof buildServer>): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    server.log.info({ name: 'Shutdown' }, `${signal} received, starting graceful shutdown`);

    try {
      // 1. Stop accepting new HTTP/WS connections, drain in-flight requests
      await server.close();
      server.log.info({ name: 'Shutdown' }, 'Fastify server closed');

      // 2. Shut down WebSocket broadcaster (clear timers, close connections)
      shutdownBroadcaster();
      server.log.info({ name: 'Shutdown' }, 'WebSocket broadcaster stopped');

      // 3. Disconnect MQTT (publishes offline LWT, tears down publisher + command handler)
      await disconnectMqtt(server.log);
      server.log.info({ name: 'Shutdown' }, 'MQTT disconnected');

      // 4. Stop UDP pipeline (close sockets)
      stopUdpPipeline(server.log);

      // 5. Close database connection pool
      await pool.end();
      server.log.info({ name: 'Shutdown' }, 'Database pool closed');

      server.log.info({ name: 'Shutdown' }, 'Graceful shutdown complete');
    } catch (err) {
      server.log.error({ name: 'Shutdown', err }, 'Error during shutdown');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

async function main(): Promise<void> {
  const server = buildServer();

  try {
    // Start Fastify HTTP server
    await server.listen({ port: config.port, host: config.host });

    // Load alarm i18n descriptions before UDP pipeline starts
    loadAlarmDescriptions();

    // Seed default admin account if auth_users table is empty
    await seedDefaultAdmin(server.log);

    // Ensure MQTT config table exists with default row
    await MqttConfigService.ensureTable();

    // Start UDP pipeline after server is listening
    await startUdpPipeline(server.log);

    // Initialize WebSocket broadcaster (subscribes to dataHub, seeds active alarms)
    await initBroadcaster(server.log);

    // Connect to MQTT broker using DB-backed config and initialize publisher +
    // command handler. Reads enabled / brokerHost / brokerPort / siteId /
    // machineId / useTls / caCert from the mqtt_config row.
    await connectMqtt(server.log);

    // Register graceful shutdown (must have server reference)
    setupGracefulShutdown(server);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
main();
