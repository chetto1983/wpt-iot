import { pgTable, serial, integer, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const rfidUsers = pgTable('rfid_users', {
  id: serial('id').primaryKey(),
  tagId: integer('tag_id').notNull().unique(),
  name: varchar('name', { length: 20 }).notNull(),
  group: integer('group').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
