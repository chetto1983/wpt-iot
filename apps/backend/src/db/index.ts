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
});

export const db = drizzle(pool, { schema });
