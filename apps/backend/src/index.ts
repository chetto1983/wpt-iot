import { buildServer } from './server.js';
import { config } from './config.js';
import { startUdpPipeline } from './udp/index.js';

async function main(): Promise<void> {
  const server = buildServer();

  try {
    // Start Fastify HTTP server
    await server.listen({ port: config.port, host: config.host });

    // Start UDP pipeline after server is listening
    await startUdpPipeline(server.log);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
main();
