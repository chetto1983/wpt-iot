import { buildServer } from './server.js';
import { config } from './config.js';
import { loadAlarmDescriptions } from './i18n/alarmDescriptions.js';
import { seedDefaultAdmin } from './auth/seed.js';
import { startUdpPipeline, stopUdpPipeline } from './udp/index.js';
import { initBroadcaster, shutdownBroadcaster } from './ws/broadcaster.js';
import { connectMqtt, disconnectMqtt } from './mqtt/connectionManager.js';
import { SparkplugService } from './mqtt/sparkplugService.js';
import { CloudUplinkWorker } from './mqtt/cloudUplinkWorker.js';
import { PlcConfigService, setPlcConfigLogger } from './udp/plcConfigService.js';
import { setPlcEndian } from './udp/parsers.js';
import { applyDatabaseBootstrap } from './db/databaseBootstrap.js';
import { pool } from './db/index.js';
import { AlarmRetentionService } from './services/alarmRetentionService.js';
import { ApplicationConfigService } from './services/applicationConfigService.js';

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
      await SparkplugService.stop();
      CloudUplinkWorker.stop();
      server.log.info({ name: 'Shutdown' }, 'MQTT and Sparkplug disconnected');

      // 4. Stop UDP pipeline (close sockets)
      stopUdpPipeline(server.log);

      // 5. Stop app-owned background cleanup before closing the DB pool
      AlarmRetentionService.stop();

      // 6. Close database connection pool
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
    // ───────────────────────────────────────────────────────────────────
    // Schema bootstrap MUST run BEFORE server.listen(). Fastify v5 executes
    // plugin bodies on listen(), and routes/energy.ts → startCycleTracker
    // fires a DB read against cycle_resets the moment the plugin body
    // runs. If we listen() first, that read races (and loses to) the
    // ensureTable below — first boot logs `Failed to load resetEpoch from
    // cycle_resets`. Functionally tolerated (resetEpoch falls back to 0)
    // but cosmetically ugly. Order: tables first, then listen.
    // ───────────────────────────────────────────────────────────────────

    // Blocking, repository-wide bootstrap. Runs every Drizzle migration and
    // every idempotent runtime schema migration before installing, backfilling,
    // and verifying all Timescale continuous aggregates. The server is not
    // marked healthy when any step fails, so the edge updater can retry safely.
    await applyDatabaseBootstrap(server.log);

    // Seed default admin account if auth_users table is empty
    await seedDefaultAdmin(server.log);

    setPlcConfigLogger(server.log);

    // Load global UI settings before any request or export can format a date.
    await ApplicationConfigService.initialize();

    // Apply the persisted PLC byte order to the parsers BEFORE the UDP pipeline
    // starts, so the running decoder matches the DB. The PUT /api/plc/config
    // route re-applies it live on save (no restart needed).
    const plcCfg = await PlcConfigService.getConfig();
    setPlcEndian(plcCfg.endian);

    // Load alarm i18n descriptions before UDP pipeline starts
    loadAlarmDescriptions();

    // Start Fastify HTTP server (this is when energy-route plugin body
    // runs and startCycleTracker reads cycle_resets — the table is now
    // guaranteed to exist).
    await server.listen({ port: config.port, host: config.host });

    // Start UDP pipeline after server is listening
    await startUdpPipeline(server.log);

    // Initialize WebSocket broadcaster (subscribes to dataHub, seeds active alarms)
    await initBroadcaster(server.log);

    // Keep plain alarm_events bounded to 24 months. Start after the broadcaster
    // seeds active alarms from the DB so the first boot snapshot is intact even
    // if very old rows get trimmed immediately afterward.
    AlarmRetentionService.start(server.log);

    // Connect to MQTT broker using DB-backed config and initialize publisher +
    // command handler. Reads enabled / brokerHost / brokerPort / siteId /
    // machineId / useTls / caCert from the mqtt_config row.
    await connectMqtt(server.log);

    // Initialize Cloud Uplink (Sparkplug B) and its Outbox worker
    await SparkplugService.init(server.log);
    CloudUplinkWorker.start(server.log);

    // Register graceful shutdown (must have server reference)
    setupGracefulShutdown(server);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
main().catch((err) => {
  // Logger not initialised yet at top level — use console so Docker supervisor
  // can see the stack trace before we exit non-zero for restart.
  console.error('Fatal startup error:', err);
  process.exit(1);
});
