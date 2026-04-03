import { buildServer } from './server.js';
import { config } from './config.js';
import { loadAlarmDescriptions } from './i18n/alarmDescriptions.js';
import { seedDefaultAdmin } from './auth/seed.js';
import { startUdpPipeline } from './udp/index.js';

async function main(): Promise<void> {
  const server = buildServer();

  try {
    // Start Fastify HTTP server
    await server.listen({ port: config.port, host: config.host });

    // Load alarm i18n descriptions before UDP pipeline starts
    loadAlarmDescriptions();

    // Seed default admin account if auth_users table is empty
    await seedDefaultAdmin(server.log);

    // Start UDP pipeline after server is listening
    await startUdpPipeline(server.log);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
main();
