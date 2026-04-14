import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    host: process.env.PG_HOST ?? 'localhost',
    port: Number(process.env.PG_PORT ?? 5432),
    database: process.env.PG_DB ?? 'wpt',
    user: process.env.PG_USERNAME ?? 'wpt',
    password: process.env.PG_PASSWORD ?? 'wpt_dev_password',
    ssl: false,
  },
});
