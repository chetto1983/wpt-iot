import { pgTable, serial, integer, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const rfidUsers = pgTable('rfid_users', {
  id: serial('id').primaryKey(),
  tagId: integer('tag_id').notNull().unique(),
  name: varchar('name', { length: 20 }).notNull(),
  group: integer('group').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rfidUserChanges = pgTable('rfid_user_changes', {
  id: serial('id').primaryKey(),
  tagId: integer('tag_id').notNull(),
  previousName: varchar('previous_name', { length: 20 }),
  previousGroup: integer('previous_group'),
  previousEnabled: boolean('previous_enabled'),
  currentName: varchar('current_name', { length: 20 }),
  currentGroup: integer('current_group'),
  currentEnabled: boolean('current_enabled'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('rfid_user_changes_detected_at_idx').on(table.detectedAt),
  index('rfid_user_changes_tag_id_idx').on(table.tagId),
]);
