import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';
import * as schema from './schema/index.js';

export const pool = new Pool({
  host: config.pgHost,
  port: config.pgPort,
  database: config.pgDb,
  user: config.pgUser,
  password: config.pgPassword,
  // Keep the PostgreSQL session on UTC. Application timezone conversion is
  // performed explicitly at the API/UI boundaries.
  options: '-c timezone=UTC',
});

export const db = drizzle(pool, { schema });
