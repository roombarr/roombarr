---
title: "Migrate persistence layer from raw bun:sqlite to Drizzle ORM"
category: database-issues
tags:
  [
    drizzle-orm,
    sqlite,
    bun,
    nestjs,
    orm,
    typescript,
    migration,
    batch-queries,
    registry-pattern,
    temporal-data,
  ]
module: Database/Snapshot/State
symptom: "Raw SQL queries with manual prepared statements, manual PRAGMA user_version migrations, N+1 query pattern in StateService (2-3 queries per media item), hardcoded state computation methods"
root_cause: "No ORM layer — raw bun:sqlite with manual string-based SQL, no type safety in queries, per-item loops in state computation, non-extensible temporal field methods"
severity: medium
date_solved: "2026-02-15"
files_changed: 28
lines_added: ~2000
lines_removed: ~330
test_coverage: "229 passing tests"
---

# Migrate Persistence Layer from Raw bun:sqlite to Drizzle ORM

## Problem

The original persistence layer used `bun:sqlite` directly with hand-written SQL strings, `PRAGMA user_version`-based migrations, and manual parameter binding. This caused three key issues:

1. **No type safety** — raw SQL strings had no compile-time feedback on column names, types, or schema changes.
2. **N+1 query pattern** — `StateService` issued 2-3 queries per media item to compute temporal state fields (`days_off_import_list`, `ever_on_import_list`). For a 1000-item library, that's 2000-3000 SQLite queries per evaluation cycle.
3. **Non-extensible state computation** — adding a new temporal field required writing a new SQL mining method in the service, not declaring the computation declaratively.
4. **Manual migration system** — `PRAGMA user_version` provided no migration journal, no rollback story, and no way for an ORM migrator to understand schema state.

## Root Cause

- **No ORM abstraction** over `bun:sqlite` — all queries were raw SQL strings.
- **Per-item queries** in state computation — the enrichment loop called the database inside a `for` loop.
- **Hardcoded state methods** instead of a data-driven registry pattern.

## Solution

### Phase 1: Drizzle Schema + Config

Defined the schema declaratively in `src/database/schema.ts`:

```typescript
export const mediaItems = sqliteTable(
  "media_items",
  {
    mediaType: text("media_type").notNull(),
    mediaId: text("media_id").notNull(),
    title: text("title").notNull(),
    data: text("data").notNull(),
    dataHash: text("data_hash").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    missedEvaluations: integer("missed_evaluations").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.mediaType, table.mediaId] })],
);
```

Two strategic indexes on `field_changes`:

- `(media_type, media_id, field_path)` for per-item lookups
- `(field_path, changed_at)` for batch state queries (critical — see Gotchas)

### Phase 2: DatabaseService with V1 Bridge Migration

The critical challenge was migrating existing v1 databases (using `PRAGMA user_version`) to Drizzle-managed schema without data loss.

**Bridge sequence:**

1. Detect v1 database via `PRAGMA user_version`
2. Backup the database file (`.sqlite`, `-wal`, `-shm`)
3. Rename table with FK ON so SQLite auto-updates FK references
4. Disable FK for DDL operations (ADD/DROP COLUMN)
5. Column migration in a transaction (add `last_seen_at`, backfill, drop `last_updated_at`)
6. Seed the Drizzle journal from `drizzle/meta/_journal.json`
7. Re-enable FK and verify with `PRAGMA foreign_key_check`

**Key insight:** Journal seeding makes Drizzle's `migrate()` see the initial migration as "already applied" — future migrations proceed normally.

### Phase 3: SnapshotService with Batch Operations

Replaced individual INSERT/UPDATE calls with chunked batch operations:

```typescript
const MEDIA_ITEMS_CHUNK_SIZE = Math.floor(999 / 8); // 124
const FIELD_CHANGES_CHUNK_SIZE = Math.floor(999 / 7); // 142
```

Composite PK upserts with `onConflictDoUpdate`:

```typescript
await tx
  .insert(mediaItems)
  .values(batch)
  .onConflictDoUpdate({
    target: [mediaItems.mediaType, mediaItems.mediaId],
    set: {
      title: sql`excluded.title`,
      data: sql`excluded.data`,
      dataHash: sql`excluded.data_hash`,
      lastSeenAt: sql`excluded.last_seen_at`,
      missedEvaluations: sql`0`,
    },
  });
```

### Phase 4: StateService with Registry Pattern

Introduced a declarative state field registry using discriminated unions:

```typescript
export const stateFieldRegistry = {
  "state.days_off_import_list": {
    type: "days_since_value",
    tracks: "radarr.on_import_list",
    value: "false",
    nullWhenCurrentNot: true,
    targets: ["radarr"],
  },
  "state.ever_on_import_list": {
    type: "ever_was_value",
    tracks: "radarr.on_import_list",
    value: "true",
    targets: ["radarr"],
  },
} satisfies Record<string, StateFieldPattern>;
```

Replaced N+1 queries with a single batch query + in-memory Map indexing:

```typescript
const allChanges = db
  .select()
  .from(fieldChanges)
  .where(inArray(fieldChanges.fieldPath, trackedPaths))
  .all();

// Build nested index: compositeKey -> fieldPath -> FieldChangeRow[]
const changeIndex = this.buildChangeIndex(allChanges);
```

Adding a new state field now requires only a registry entry and a `StateData` interface update — no SQL or service code changes.

## Prevention Strategies

### When Adding New Schema Changes

- Always use `drizzle-kit generate` — never manually edit migration SQL files
- If adding a NOT NULL column, use `DEFAULT` to avoid constraint violations during migration
- After migration, run `PRAGMA foreign_key_check` to verify FK integrity

### When Creating New State Fields

- Add entries to `state-registry.ts` — never add computation methods directly to `StateService`
- Available patterns: `days_since_value` and `ever_was_value`
- For new pattern types, add to the `StateFieldPattern` discriminated union

### When Writing Batch Operations

- Always chunk: `Math.floor(999 / columnCount)` rows per INSERT
- Use `await db.transaction(async tx => { ... })` — all operations via `tx`, not `db`
- Keep lock window small: no API calls inside transactions

### When Running Future Bridge Migrations

- Backup before any DDL: `copyFileSync(dbPath, dbPath + '.backup')`
- Wrap all DDL in `db.transaction()` — SQLite supports transactional DDL
- FK protocol: OFF before DDL, ON after, then `foreign_key_check`
- Seed the Drizzle journal inside the bridge transaction for atomicity

## Gotchas

### SQLite Leftmost-Prefix Index Rule

Index `(a, b, c)` can efficiently serve `WHERE a = ?` or `WHERE a = ? AND b = ?`, but **cannot** serve `WHERE c = ?` — that's a full table scan. The batch state query uses `WHERE field_path IN (...)`, so `field_path` must be the **first** column of its index. The `(field_path, changed_at)` index was added specifically for this.

### Drizzle Transactions Are Async

Even though `bun:sqlite` is synchronous, Drizzle's transaction API is async. Always use `await db.transaction(async tx => { ... })`. Missing `await` silently drops the transaction.

### Use `tx` Not `db` Inside Transactions

Inside the transaction callback, all operations must use the `tx` parameter. Using the global `db` bypasses the transaction boundary.

### `sql` Template Literals for Dynamic Values

Use `sql` for runtime-computed values:

- `sql`datetime('now')`` for SQLite function calls
- `sql`excluded.column_name`` for conflict clause references
- `sql`${table.column} + 1`` for computed expressions

### PRAGMA foreign_keys Is Per-Connection

Must be set immediately after creating the `Database` instance, before Drizzle wraps it. If set after operations, it may not take effect.

### SQLite 999 Bound Parameter Limit

Multi-row inserts hit `SQLITE_TOOBIG` if total parameters exceed 999. Calculate chunk size as `Math.floor(999 / columnCount)`.

## Related Documentation

- [Migration Plan](../../plans/2026-02-15-feat-drizzle-orm-persistence-migration-plan.md) — full 5-phase implementation plan
- [Architecture Brainstorm](../../brainstorms/2026-02-15-drizzle-persistence-layer-brainstorm.md) — design exploration and approach selection
- [Import List Lifecycle Plan](../../plans/2026-02-14-feat-import-list-lifecycle-rules-plan.md) — the feature that motivated the persistence layer
- [Rule Engine Plan](../../plans/2026-02-14-feat-rule-based-media-cleanup-engine-plan.md) — core v1 feature powered by the persistence layer

## Verification

- 229 tests passing, 0 failures
- Lint clean (Biome)
- 28 files changed, ~2000 lines added, ~330 removed
- 5 atomic commits on the `sqlite` branch
