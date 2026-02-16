import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const mediaItems = sqliteTable(
  'media_items',
  {
    mediaType: text('media_type').notNull(),
    mediaId: text('media_id').notNull(),
    title: text('title').notNull(),
    data: text('data').notNull(),
    dataHash: text('data_hash').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    missedEvaluations: integer('missed_evaluations').notNull().default(0),
  },
  table => [primaryKey({ columns: [table.mediaType, table.mediaId] })],
);

export const fieldChanges = sqliteTable(
  'field_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaType: text('media_type').notNull(),
    mediaId: text('media_id').notNull(),
    fieldPath: text('field_path').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedAt: text('changed_at').notNull(),
  },
  table => [
    index('idx_field_changes_lookup').on(
      table.mediaType,
      table.mediaId,
      table.fieldPath,
    ),
    index('idx_field_changes_state').on(table.fieldPath, table.changedAt),
    foreignKey({
      columns: [table.mediaType, table.mediaId],
      foreignColumns: [mediaItems.mediaType, mediaItems.mediaId],
    }).onDelete('cascade'),
  ],
);
