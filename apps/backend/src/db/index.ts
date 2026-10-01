import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool, type ClientConfig } from 'pg';
import { config } from '../config.js';
import * as schema from './schema/index.js';

export const connectionConfig: ClientConfig = {
  host: config.pgHost,
  port: config.pgPort,
  database: config.pgDb,
  user: config.pgUser,
  password: config.pgPassword,
  // Keep the PostgreSQL session on UTC. Application timezone conversion is
  // performed explicitly at the API/UI boundaries.
  options: '-c timezone=UTC',
};

export const pool = new Pool(connectionConfig);

export const db = drizzle(pool, { schema });

/** Runs `fn` on a brand-new session, never a pooled one, and always closes it. */
export async function withFreshSession<T>(
  database: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ ...connectionConfig, database });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end();
  }
}
