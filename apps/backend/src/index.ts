import { buildServer } from './server.js';
import { config } from './config.js';
import { loadAlarmDescriptions } from './i18n/alarmDescriptions.js';
import { seedDefaultAdmin } from './auth/seed.js';
import { startUdpPipeline, stopUdpPipeline } from './udp/index.js';
import { initBroadcaster, shutdownBroadcaster } from './ws/broadcaster.js';
import { connectMqtt, disconnectMqtt } from './mqtt/connectionManager.js';
import { MqttConfigService } from './mqtt/configService.js';
import { EnergyConfigService } from './services/energyConfigService.js';
import { EnergyBaselineService } from './services/energyBaselineService.js';
import { PlcConfigService, setPlcConfigLogger } from './udp/plcConfigService.js';
import { MachineSchemaMigrationService } from './db/machineSchemaMigrationService.js';
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
    // ───────────────────────────────────────────────────────────────────
    // Schema bootstrap MUST run BEFORE server.listen(). Fastify v5 executes
    // plugin bodies on listen(), and routes/energy.ts → startCycleTracker
    // fires a DB read against cycle_resets the moment the plugin body
    // runs. If we listen() first, that read races (and loses to) the
    // ensureTable below — first boot logs `Failed to load resetEpoch from
    // cycle_resets`. Functionally tolerated (resetEpoch falls back to 0)
    // but cosmetically ugly. Order: tables first, then listen.
    // ───────────────────────────────────────────────────────────────────

    // Seed default admin account if auth_users table is empty
    await seedDefaultAdmin(server.log);

    // Ensure MQTT config table exists with default row
    await MqttConfigService.ensureTable();

    // Ensure Phase 19 energy tables exist + seed the default tariff period
    // (energy_config singleton, energy_config_periods, cycle_records,
    // cycle_resets). Direct SQL idempotent — never drizzle-kit push.
    // Pattern mirrors MqttConfigService.ensureTable() exactly. ECFG-01..06.
    await EnergyConfigService.ensureTable();

    // Phase 20 baseline schema — energy_baselines + baseline_evidence.
    // Direct SQL idempotent CREATE TABLE IF NOT EXISTS. Must run AFTER
    // EnergyConfigService.ensureTable() because Phase 20 references the
    // `energy_config_periods` values at lock time (ENBL-01, ENBL-06).
    await EnergyBaselineService.ensureSchema();

    // Ensure PLC config table exists with default row (target_host='localhost').
    // Operators update the target from the frontend (SUPER_ADMIN only) and the
    // handshake FSM picks it up via the 30s-TTL cache on its next read.
    await PlcConfigService.ensureTable();
    setPlcConfigLogger(server.log);

    // [BLOCKING] V03 protocol schema migration (PROT-V03-04, PROT-V03-05).
    // Renames spare_int_71/72 -> cycle_status/container and adds 8 new REAL
    // columns. Idempotent. MUST run before startUdpPipeline() — the UDP parser
    // INSERTs rows assuming the V03 schema and would throw on a pre-V03 DB.
    await MachineSchemaMigrationService.ensureV03Columns();

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
