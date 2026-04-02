import { buildServer } from './server.js';
import { config } from './config.js';

async function main(): Promise<void> {
  const server = buildServer();
  try {
    await server.listen({ port: config.port, host: config.host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}
main();
