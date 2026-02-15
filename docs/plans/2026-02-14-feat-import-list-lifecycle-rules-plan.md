---
title: "feat: Import List Lifecycle Rules with Persistence Layer"
type: feat
status: completed
date: 2026-02-14
deepened: 2026-02-14
---

# Import List Lifecycle Rules with Persistence Layer

## Enhancement Summary

**Deepened on:** 2026-02-14
**Research agents used:** TypeScript reviewer, Performance oracle, Simplicity reviewer, Security sentinel, Architecture strategist, Pattern recognition specialist, Data integrity guardian, NestJS patterns researcher, CDC/event sourcing researcher, bun:sqlite best practices researcher

### Key Improvements
1. **Transaction safety** — All per-cycle writes (UPSERTs + field_changes INSERTs) must be wrapped in a single `db.transaction()` call for atomicity
2. **JSON determinism** — Use `microdiff` library for structural diffing instead of JSON.stringify comparison; sort arrays before diffing to avoid phantom changes
3. **Field-registry-driven snapshots** — Use existing `fieldRegistry` + `resolveField()` to drive snapshot creation instead of generic JSON flattening, keeping the snapshot aligned with what the rules engine cares about
4. **Retention safety** — Always preserve the most recent `field_changes` entry per `(media_id, field_path)` regardless of age, preventing temporal queries from losing their anchor point
5. **Schema hardening** — Add FK with `ON DELETE CASCADE` between `field_changes` and `media_snapshots`; allow `new_value` to be NULL; add `PRAGMA foreign_keys = ON`
6. **NestJS lifecycle** — Must add `app.enableShutdownHooks()` to `main.ts` for `OnModuleDestroy` to fire on SIGTERM in Docker containers
7. **Partial snapshot merges** — Only update snapshot fields for services that were actually hydrated in the current run, respecting the lazy-loading pattern

### New Considerations Discovered
- `state` as a service type is a semantic mismatch — every other entry in the `ServiceName` union maps to an external API with a client/mapper pair; `state` is an internal computation. Consider a `source: 'external' | 'computed'` discriminator or treat `state` as always-present without adding it to the external union.
- First evaluation should **not** generate `field_changes` entries at all (skip diffing on true INSERTs, not UPDATEs) to avoid write amplification (~15 change records per item × 1000 items = 15,000 pointless rows).
- Orphan cleanup should use a grace period or soft-delete — an item that disappears from the API and reappears (flaky API) should not lose its temporal history.
- Docker container runs as root (no `USER` directive in Dockerfile) — add a non-root user before this feature ships.
- `app.enableShutdownHooks()` is not called in `main.ts` — required for `OnModuleDestroy` to fire on SIGTERM/SIGINT.

## Overview

Add a snapshot-first SQLite persistence layer to Roombarr and use it to power import list lifecycle rules. The persistence layer snapshots the entire unified media model each evaluation, enabling temporal rule fields like "days since this movie fell off an import list." This solves the core problem that drives Roombarr's existence: import lists bring media in, but nothing takes it out.

## Problem Statement / Motivation

Radarr's import lists are a powerful discovery tool — they auto-download movies from third-party lists (MDBList, Trakt, etc.), keeping a server fresh with new content. But this is a one-way door: media flows in and never flows out, causing disk space to fill up over time.

Radarr itself does not track which import list added a movie after the fact (the `addOptions.addMethod` field is cleared post-import, and the movie object has no `importListId`). There is no built-in mechanism to remove movies when they fall off a list.

Roombarr is currently **stateless** — every evaluation fetches fresh data and discards history. To answer "has this movie been off all import lists for 30 days?", temporal state is required. This persistence layer is the missing piece that turns Roombarr from a point-in-time evaluator into a lifecycle manager.

## Proposed Solution

### Architecture: Snapshot-First Design

Instead of SQLite being a sidecar for specific temporal fields, it becomes the canonical state layer. Every evaluation writes the full unified media model to SQLite, and field-level changes are tracked in an append-only change log. This gives temporal lookback capabilities for **any** field without per-field opt-in.

```
1. HYDRATE    — Fetch from APIs, build UnifiedMedia[] in memory
2. SNAPSHOT   — Write unified models to SQLite, diff against previous snapshot, record changes
3. ENRICH     — Compute temporal state fields (e.g., days_off_import_list) from change history
4. EVALUATE   — Evaluate rules against enriched unified models (in memory)
```

### Part 1: SQLite Persistence Layer

A lightweight SQLite database using `bun:sqlite` (built-in, zero dependencies).

**Database location:** `/data/roombarr.sqlite` (Docker volume mount)

**Schema:**

```sql
-- Version tracking for future migrations
CREATE TABLE schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Latest snapshot of each media item's unified model
CREATE TABLE media_snapshots (
  media_type TEXT NOT NULL,            -- 'movie' | 'season'
  media_id TEXT NOT NULL,              -- tmdb_id for movies, 'tvdb_id:season_number' for seasons
  title TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: flattened unified model fields (dotted keys)
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (media_type, media_id)
);

-- Append-only log of field value changes
CREATE TABLE field_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL,
  media_id TEXT NOT NULL,
  field_path TEXT NOT NULL,            -- dotted path, e.g., 'radarr.on_import_list'
  old_value TEXT,                      -- JSON-serialized, null for first observation
  new_value TEXT NOT NULL,             -- JSON-serialized
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_field_changes_lookup
  ON field_changes(media_type, media_id, field_path);

CREATE INDEX idx_field_changes_cleanup
  ON field_changes(changed_at);
```

**Key design decisions:**

- **`media_snapshots` stores flattened dotted keys** — the `data` column contains JSON with keys like `"radarr.tags"`, `"jellyfin.play_count"`, matching the field paths used in rules and in `field_changes`. This makes diffing straightforward: iterate keys, compare values, record changes.
- **`field_changes` is append-only** — every field value change is recorded with a timestamp. This enables temporal queries like "when did `radarr.on_import_list` change from `true` to `false`?" without scanning full snapshots.
- **Retention-based cleanup** — `field_changes` rows older than a configurable retention period (default 90 days) are pruned after each evaluation. This bounds table growth while preserving enough history for temporal rules.
- **`media_id` uses `tmdb_id`** — consistent with the existing cross-service join key.
- **`bun:sqlite` with WAL mode** — zero dependencies, synchronous API, crash-safe.
- **Schema versioning from day one** — `PRAGMA user_version` for tracking, manual migration functions in code.

#### Research Insights: Schema & Persistence

**Best Practices (from data integrity, performance, and bun:sqlite research):**
- Add a **foreign key with `ON DELETE CASCADE`** from `field_changes` to `media_snapshots`. Without it, orphan `field_changes` rows accumulate for deleted media items. Enable with `PRAGMA foreign_keys = ON` on every connection.
- **`new_value` should allow `NULL`** — fields like `jellyfin.last_played` can legitimately transition from a value to `null` (e.g., Jellyseerr request deleted). The `NOT NULL` constraint would prevent recording this.
- Use **`PRAGMA user_version`** instead of a `schema_version` table. SQLite provides this built-in integer pragma for exactly this purpose. Simpler, no extra table, no extra queries.
- Wrap all pending migrations in a **single transaction** so partial application is impossible. Use `CREATE TABLE IF NOT EXISTS` for idempotency.

**SQLite PRAGMAs (from bun:sqlite and performance research):**
```sql
PRAGMA journal_mode = WAL;          -- Write-Ahead Logging: +40% concurrent performance
PRAGMA synchronous = NORMAL;        -- 3x faster than FULL; safe with WAL mode
PRAGMA foreign_keys = ON;           -- Enforce FK constraints (OFF by default!)
PRAGMA busy_timeout = 5000;         -- Wait 5s on lock instead of immediate SQLITE_BUSY
```
`cache_size` and `mmap_size` tuning provides marginal gains (<8%) and is unnecessary for this workload (sub-1000 items). Defaults are sufficient.

**Revised schema (incorporating findings):**
```sql
CREATE TABLE field_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL,
  media_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  old_value TEXT,                    -- JSON-serialized, null for first observation
  new_value TEXT,                    -- JSON-serialized, NULL allowed for field→null transitions
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (media_type, media_id)
    REFERENCES media_snapshots(media_type, media_id)
    ON DELETE CASCADE
);
```

**Performance (from performance oracle):**
- Batch-read ALL existing snapshots into a `Map<string, SnapshotRow>` at the start of each cycle — one `SELECT * FROM media_snapshots` instead of 1000 individual lookups.
- Wrap ALL per-cycle writes (UPSERTs + field_changes INSERTs) in a **single `db.transaction()` call**. Without this, a crash between snapshot write and change record write leaves the database inconsistent.
- Add a **content hash** (`data_hash`) column to `media_snapshots` using `Bun.hash()`. Skip the full diff for items whose hash hasn't changed — this avoids JSON parsing for the ~95% of items that are unchanged between evaluations.
- Use a **temp table** for orphan cleanup instead of `NOT IN (...)` with large parameter lists.

### Part 2: Radarr Import List Data Fetching

**Data source:** `GET /api/v3/importlist/movie` returns all movies known to Radarr's import lists, each with a `lists: number[]` field containing the IDs of import lists the movie appears on. Cross-reference with library movies by `tmdbId`.

Import list data is fetched during the hydration phase (step 1) alongside existing Radarr data, and the results are added to the unified model as new `RadarrData` fields.

**New Radarr client method:**

```typescript
// src/radarr/radarr.client.ts
fetchImportListMovies(): Promise<RadarrImportListMovie[]>
```

**New Radarr type:**

```typescript
// src/radarr/radarr.types.ts
interface RadarrImportListMovie {
  tmdbId: number;
  lists: number[];        // Import list IDs this movie appears on
  title: string;
  isExisting: boolean;    // Already in Radarr library
}
```

**New fields on `RadarrData`** (`src/shared/types.ts`):

```typescript
interface RadarrData {
  // ... existing fields ...
  on_import_list: boolean;       // true if movie appears in import list response
  import_list_ids: number[];     // which import lists the movie is on
}
```

### Part 3: Snapshot Pipeline

The `SnapshotService` runs after hydration and before rule evaluation. It writes the full unified model to SQLite and detects field-level changes.

**Per-evaluation logic:**

1. **Flatten** each `UnifiedMedia` item to a dotted-key map (e.g., `{ "radarr.tags": ["action"], "jellyfin.play_count": 2, "radarr.on_import_list": true }`)
2. **Read** the previous snapshot from `media_snapshots` for each item
3. **Diff** current flattened data against previous snapshot, key by key
4. **Record** changes in `field_changes` (only fields whose JSON-serialized values differ)
5. **Upsert** `media_snapshots` with the current flattened data
6. **Cleanup** orphan snapshots (items no longer in the library) and expired `field_changes` rows

**First evaluation (empty database):** Every item gets a new `media_snapshots` row. **No `field_changes` entries are generated on the first observation** — diffing only runs when updating an existing snapshot, not on initial insert. This avoids write amplification (15+ fields × 1000 items = 15,000+ pointless rows). On first evaluation, all temporal fields return `null`.

#### Research Insights: Snapshot Pipeline

**Diffing strategy (from CDC research and pattern recognition):**
- Use **`microdiff`** (sub-1kb, zero deps, TypeScript-native, MIT license, 645k weekly downloads) for structural diffing instead of manual JSON.stringify comparison. It returns `{ type: "CHANGE", path: ["radarr", "tags"], value, oldValue }` entries that map directly to `field_path` via `path.join(".")`.
- **Sort arrays before diffing** — `tags`, `watched_by`, `import_list_ids` can return in different order from APIs. Without sorting, `["action", "sci-fi"]` vs `["sci-fi", "action"]` is a phantom change. Pre-sort array fields before comparison.
- **Use the field registry to drive snapshot creation** instead of generic object flattening. Iterate `fieldRegistry[target]` keys and resolve each via `resolveField()`. This reuses existing infrastructure and stays aligned with what rules actually reference, avoiding a parallel untyped representation.

**Partial snapshot merges (from architecture strategist):**
- The snapshot should only capture fields for services that were **actually hydrated**. If rules only reference Radarr and Jellyfin was not fetched, the snapshot should NOT overwrite existing Jellyfin fields from a previous run. A full-replacement strategy would cause Jellyfin data to appear "deleted" from the snapshot, generating spurious field changes.
- `SnapshotService` must accept a set of hydrated services alongside the items and only diff/overwrite fields belonging to those services.

**Orphan cleanup (from architecture strategist):**
- Use a **grace period** before purging orphan snapshots. An item that disappears from the API and reappears one evaluation later (flaky API) should not lose its temporal history. Consider a `last_seen_at` column on `media_snapshots` and only delete items not seen for N evaluations.

**Content hash optimization (from performance oracle):**
```typescript
// Skip full diff for unchanged items (~95% of library per cycle)
const currentHash = Bun.hash(stableStringify(flattenedData));
if (currentHash === storedHash) continue; // No changes, skip diffing
```

### Part 4: Temporal State Computation

After snapshotting, the `StateService` computes temporal fields by querying `field_changes`. These are attached to the unified model as `StateData` before rule evaluation.

#### `state.days_off_import_list` (number | null)

Computed from the `field_changes` table:

1. Get the current value of `radarr.on_import_list` for this movie
2. If `true`: return `null` (currently on a list — no grace period)
3. If `false`: find the most recent `field_changes` entry where `field_path = 'radarr.on_import_list'` and `new_value = 'false'`
4. Return `floor((now - changed_at) / 1 day)`
5. If no change history exists (movie was never observed on a list): return `null`

#### `state.ever_on_import_list` (boolean)

`true` if any `field_changes` row exists for this movie where `field_path = 'radarr.on_import_list'` and `new_value = 'true'`, OR if the current value of `radarr.on_import_list` is `true`.

**Null semantics (critical for rule authoring):**

| Scenario | `on_import_list` | `import_list_ids` | `days_off_import_list` | `ever_on_import_list` |
|---|---|---|---|---|
| Currently on a list | `true` | `[1, 3]` | `null` | `true` |
| Fell off list 5 days ago | `false` | `[]` | `5` | `true` |
| Fell off list 31 days ago | `false` | `[]` | `31` | `true` |
| Never seen on any list | `false` | `[]` | `null` | `false` |

- `days_off_import_list` is `null` when currently on a list (safe) or never observed (unknown)
- `days_off_import_list greater_than 30` only matches movies that **were** on a list and have been off 30+ days
- Movies added manually (never on a list) are unaffected — use `state.ever_on_import_list equals false` to target them explicitly

### Part 5: Field Registry & Config Validation

**Field registry changes** (`src/config/field-registry.ts`):

```typescript
// New service type
type ServiceName = 'radarr' | 'sonarr' | 'jellyfin' | 'jellyseerr' | 'state';

// New radarr fields (added to radarrFields block)
'radarr.on_import_list':  { type: 'boolean', service: 'radarr' },
'radarr.import_list_ids': { type: 'array',   service: 'radarr' },

// New state fields (new stateFields block, merged into radarr target only for now)
'state.days_off_import_list': { type: 'number',  service: 'state' },
'state.ever_on_import_list':  { type: 'boolean', service: 'state' },
```

**Missing data check:** The `checkMissingServiceData` method in `RulesService` must treat `state` as always-present (like `radarr`/`sonarr` base data), not as an optional enrichment service. State data is computed locally from SQLite and is always available.

#### Research Insights: Field Registry & State Namespace

**Semantic concern (from pattern recognition specialist):**
Adding `'state'` to the `ServiceName` union introduces a conceptual mismatch. Every other value in that union maps to: (1) an external HTTP API, (2) a `*Client` class, (3) a `*Mapper` that transforms its response, and (4) a `*Service` that orchestrates fetching. The `'state'` value breaks all four associations — it is an internal computation, not an external data source.

**Options:**
1. **Keep `state.*` prefix but handle specially** — add `'state'` to the union but hardcode it as always-present in `checkMissingServiceData`. Simplest, minor semantic compromise.
2. **Add a `source` discriminator** — `{ type, service, source: 'external' | 'computed' }`. More explicit but adds complexity to an otherwise simple registry.
3. **Different prefix** — `computed.*` or `history.*` to make the distinction visible to users configuring rules.

**Recommendation:** Option 1. The semantic impurity is minor and confined to the type definition. Users already interact with `state.*` fields in YAML config — changing the prefix adds confusion for no practical benefit.

**First-run behavior (from architecture strategist):**
- `StateData` should be **`null`** on the first evaluation (no history exists), NOT a zero-initialized object. This preserves the existing null-skip pattern in `checkMissingServiceData` — rules referencing `state.*` fields are safely skipped for items with no temporal history.
- After the first snapshot exists, `StateData` should be populated with computed values (which may themselves be `null` for individual fields like `days_off_import_list`).

### Part 6: API Failure Safety

The snapshot-first architecture provides **structural** API failure safety — no special circuit-breaker logic needed.

**How it works:**

1. During hydration, if a service API fails (e.g., Radarr import list endpoint, Jellyfin), the existing `fetch*Safe()` pattern returns empty/null data for that service.
2. The `SnapshotService` detects that the service data is null/empty and **skips snapshotting for those fields** — it does not write "empty" data that would be interpreted as a state change.
3. The previous snapshot in `media_snapshots` retains the last-known values for those fields.
4. Temporal computations from `field_changes` remain accurate because no false "changed to empty" entries were recorded.
5. A warning is logged and the service is added to the evaluation run's degraded list.

**Why this is safe:** The key invariant is that `field_changes` entries are only recorded for **genuine** state transitions, not for API failures. The `SnapshotService` must distinguish "this field's value is legitimately empty" from "we couldn't fetch this field's data" — it does this by checking whether the service data on the unified model is null (API failure) vs. populated with an empty/false value (legitimate state).

**First evaluation (empty database + API failure):** `StateData` is null for all movies. Rules referencing `state.*` fields are skipped via the existing missing-data-check. This is safe — no actions are taken on unknown state.

## Technical Considerations

### Architecture

- **DatabaseService** (`src/database/`): Global NestJS module wrapping `bun:sqlite`. Handles initialization, WAL pragma, migrations, and clean shutdown via lifecycle hooks. Follows the existing `ConfigModule` pattern (`@Global()` + provider export).
- **SnapshotService** (`src/snapshot/`): Consumes `DatabaseService`. Handles writing unified models to SQLite, diffing against previous snapshots, recording field changes, and cleanup. Injected into the evaluation pipeline between hydration and rule evaluation.
- **StateService** (`src/state/`): Consumes `DatabaseService`. Computes temporal state fields from `field_changes` history. Injected into `MediaService` for enrichment.
- **Radarr client extension**: One new method on the existing `RadarrClient` for the import list movies endpoint. No new module needed.

#### Research Insights: Architecture

**Pipeline placement (from architecture strategist):**
The new steps should be inserted into `EvaluationService.executeEvaluation()`, not embedded in `MediaService.hydrate()`. This keeps `EvaluationService` as the single orchestrator (its existing role) and avoids mixing API hydration concerns with persistence concerns:

```typescript
// In EvaluationService.executeEvaluation()
const items = await this.mediaService.hydrate(rules);      // Step 1: HYDRATE
await this.snapshotService.snapshot(items, hydratedServices); // Step 2: SNAPSHOT
const enriched = this.stateService.enrich(items);           // Step 3: ENRICH
const { results, summary } = this.rulesService.evaluate(enriched, rules); // Step 4: EVALUATE
```

**Module structure (from NestJS patterns research):**
```
DatabaseModule (@Global)
  └─ DatabaseService: connection lifecycle, PRAGMAs, migrations

SnapshotModule
  ├─ imports: [DatabaseModule]  (auto-available via @Global)
  ├─ SnapshotService: write snapshots, diff, orphan management
  ├─ StateService: compute temporal fields from field_changes
  └─ exports: [SnapshotService, StateService]

EvaluationModule
  └─ imports: [ConfigModule, MediaModule, RulesModule, SnapshotModule]
```

Both `SnapshotService` and `StateService` are always-present infrastructure — they should NOT use the optional DI pattern (`{ token, optional: true }`) used by Jellyfin/Jellyseerr.

**NestJS lifecycle (from NestJS research):**
- `@Global()` modules initialize **first** and destroy **last** — guarantees DB is ready before dependents and closes after them.
- **Must add `app.enableShutdownHooks()` to `main.ts`** — without this, `OnModuleDestroy` never fires on SIGTERM/SIGINT, meaning the SQLite connection leaks on Docker container stop.
- Constructor injection (not `useFactory`) for `DatabaseService` — `ConfigService` is already globally available.

**Synchronous SQLite (from architecture strategist):**
`bun:sqlite` is synchronous and blocks the event loop during writes. For this workload (periodic batch evaluation, not high-throughput HTTP), this is acceptable. The app already serializes evaluation runs via the `this.running` flag. Document the constraint in `DatabaseService` JSDoc; if it becomes a problem, `bun:worker` can offload writes later.

**Service merging consideration (from pattern recognition):**
The pattern recognition specialist suggested merging `SnapshotService` and `StateService` since they always run in sequence. However, keeping them separate maintains clearer single-responsibility boundaries — `SnapshotService` owns persistence, `StateService` owns temporal computation. Keep separate unless the boundary proves artificial during implementation.

### Performance

- **Snapshot writes:** One UPSERT per media item per evaluation. For a library of 1000 movies, that's ~1000 synchronous SQLite writes per eval. `bun:sqlite` handles this in milliseconds.
- **Change detection:** Use `microdiff` for structural comparison — ~20 fields per item, sub-millisecond for 1000 items.
- **Content hash skip:** Add `data_hash` column using `Bun.hash()`. ~95% of items are unchanged between evaluations — skip full diffing for these entirely.
- **Temporal queries:** One indexed SELECT per item for `days_off_import_list`. O(1) per item with the composite index.
- **Cleanup:** One DELETE for orphan snapshots, one DELETE for expired changes. Both use indexed columns.
- **Import list fetch:** Single HTTP call, not per-movie. Adds one API call per evaluation.
- **Batch reads:** Load ALL snapshots into a `Map` at cycle start with one `SELECT *` — not 1000 individual lookups.
- **Transaction wrapping:** ALL writes in a single `db.transaction()` — atomic and ~100x faster than individual auto-committed writes.

#### Research Insights: Performance

**Sizing estimates (from CDC research):**
- Realistic field changes per cycle: ~30-50 (most media metadata is stable day-to-day)
- 90-day `field_changes` size: ~4,500 rows, ~765 KB — a non-concern
- `media_snapshots` size: ~500 KB for 1000 items (upserted, never grows)
- Total database size at steady state: **< 2 MB**

**Retention cleanup (from data integrity guardian):**
Use **batched deletes** with `LIMIT` to avoid long SQLite locks during retention pruning:
```sql
DELETE FROM field_changes
WHERE changed_at < datetime('now', '-90 days')
  AND id NOT IN (
    SELECT MAX(id) FROM field_changes
    GROUP BY media_type, media_id, field_path
  )
LIMIT 1000;
```
This preserves the most recent change per field_path regardless of age (preventing temporal query anchor loss) and keeps individual transactions small.

### Docker

```yaml
# docker-compose.yml
services:
  roombarr:
    volumes:
      - ./config:/config:ro
      - roombarr-data:/data        # Persistent, writable volume for SQLite

volumes:
  roombarr-data:
```

The SQLite file, WAL file, and SHM file all live in `/data/` on the same filesystem (required for SQLite locking). Named volume survives `docker compose down/up` cycles.

#### Research Insights: Docker (from security sentinel)

Add a non-root user to the Dockerfile before this feature ships:
```dockerfile
RUN addgroup -S roombarr && adduser -S roombarr -G roombarr
RUN mkdir -p /data && chown -R roombarr:roombarr /app /data
USER roombarr
```
This ensures the SQLite file is owned by a non-root user, reducing blast radius of any container escape. The `/data` directory must be created and owned by the app user before the volume mount.

### Sonarr Parity

This feature is **Radarr-only** for now. The snapshotting layer stores all media types (movies and seasons), but the import-list-specific fields (`radarr.on_import_list`, `radarr.import_list_ids`) and computed state fields (`state.days_off_import_list`, `state.ever_on_import_list`) only apply to `target: radarr` rules. Config validation should reject these fields on `target: sonarr` rules. Sonarr has a similar import list API and can be added later.

### Future Temporal Fields

Because the snapshot layer tracks changes to **all** fields, adding new temporal rules in the future requires no schema changes — only a new computation in `StateService`. Examples:

- `state.days_since_added` — computed from `field_changes` where `field_path = 'radarr.added'`
- `state.days_since_last_watched` — computed from changes to `jellyfin.last_played`
- `state.days_unmonitored` — computed from changes to `radarr.monitored`

## Acceptance Criteria

### Persistence Layer
- [x] SQLite database initializes at `/data/roombarr.sqlite` on first startup
- [x] PRAGMAs set: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`
- [x] Schema version tracked via `PRAGMA user_version` (not a separate table)
- [x] `media_snapshots` and `field_changes` tables created with proper schema, indexes, and FK constraint
- [x] Database connection closes cleanly on shutdown (`OnModuleDestroy`)
- [x] `app.enableShutdownHooks()` added to `main.ts` for Docker SIGTERM handling
- [x] Database file persists across Docker container restarts via volume mount
- [ ] Database file permissions set to `0600`
- [x] `DatabaseService` is injectable globally via `@Global()` module
- [x] All SQL uses prepared statements with `?` placeholders (no string interpolation)

### Import List Data
- [x] `RadarrClient` fetches import list movies via `GET /api/v3/importlist/movie`
- [x] Import list movies are cross-referenced with library movies by `tmdbId`
- [x] Only `isExisting: true` movies are considered
- [x] `radarr.on_import_list` and `radarr.import_list_ids` populated on `RadarrData`

### Snapshotting
- [x] Each evaluation writes the full unified model to `media_snapshots` (one row per item)
- [x] Field-level changes detected using `microdiff` (or equivalent structural diff)
- [x] Arrays sorted before diffing to avoid phantom changes from ordering differences
- [x] Changes recorded in `field_changes` with `old_value`, `new_value`, `changed_at`
- [x] First-observation items (no previous snapshot) skip `field_changes` generation entirely
- [x] ALL per-cycle writes wrapped in a single `db.transaction()` call
- [x] Content hash (`data_hash`) used to skip diffing for unchanged items
- [x] Only fields for hydrated services are diffed/overwritten (partial snapshot merge)
- [x] Orphan snapshots cleaned up with grace period (not immediately on first absence)
- [x] Expired `field_changes` rows pruned, but most recent entry per `(media_id, field_path)` always preserved
- [x] API failure for a service skips snapshotting for that service's fields (no false state changes recorded)

### Temporal State Fields
- [x] `state.days_off_import_list` (number | null): days since `radarr.on_import_list` changed to `false`; `null` if currently on a list or never observed
- [x] `state.ever_on_import_list` (boolean): `true` if change history shows the movie was ever on an import list
- [x] All fields registered in field registry with correct types and operator compatibility
- [x] `state` fields treated as always-present by `checkMissingServiceData`

### Config Validation
- [x] Rules referencing new fields pass validation for `target: radarr`
- [x] Rules referencing `state.*` fields on `target: sonarr` are rejected with a clear error

### Example Rule Config
```yaml
rules:
  # Delete movies that fell off all import lists 30+ days ago
  - name: "Clean stale import list movies"
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: radarr.has_file
          operator: equals
          value: true
        - field: state.ever_on_import_list
          operator: equals
          value: true
        - field: state.days_off_import_list
          operator: greater_than
          value: 30

  # Keep anything still on an import list
  - name: "Keep import list movies"
    target: radarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: radarr.on_import_list
          operator: equals
          value: true

  # Keep anything that's been watched by at least one person
  - name: "Keep watched movies"
    target: radarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: jellyfin.play_count
          operator: greater_than
          value: 0
```

## Success Metrics

- Movies that fall off import lists are automatically cleaned up after the grace period, freeing disk space
- Movies protected by keep rules (watched, tagged, etc.) are never deleted regardless of import list status
- API outages do not corrupt state or trigger false deletions
- SQLite database remains bounded (orphan cleanup + change log retention)
- Adding future temporal rules requires only a new `StateService` computation, no schema changes

### Security

#### Research Insights: Security (from security sentinel)

**Relevant to this feature:**
- **Set explicit SQLite file permissions** — `chmod 0600` on the database, WAL, and SHM files. Without this, the container's root user creates world-readable files containing media metadata and watch history (PII-adjacent).
- **SQL injection prevention** — ALL queries must use `bun:sqlite`'s prepared statement API with `?` placeholders. No string concatenation or template literals in SQL. The field path regex at `config.schema.ts` (`/^[a-z][a-z0-9_.]*$/`) provides defense-in-depth.
- **Error messages** — sanitize errors stored in `EvaluationRun.error` before exposing via API. Upstream API errors can contain internal hostnames and ports.
- **`watched_by` in snapshots** — the `JellyfinData.watched_by` field contains Jellyfin usernames. Document that the SQLite database contains user watch history and the `/data` volume should be treated as sensitive data.

**Pre-existing issues to address alongside this feature:**
- Add `USER` directive to Dockerfile (non-root container user)
- Add `app.enableShutdownHooks()` to `main.ts` (required for clean DB shutdown)

## Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Radarr import list API shape differs from research | Verify against a running Radarr instance before implementation; the `lists: number[]` field on import list movies needs confirmation |
| API outage records false state changes | `SnapshotService` skips fields for services with null data; only genuine transitions are recorded |
| SQLite corruption in Docker | WAL mode + named volume; no NFS/network mounts; set `synchronous = NORMAL` |
| `field_changes` unbounded growth | Retention-based cleanup (default 90 days); always preserves most recent change per field_path |
| Snapshot writes slow down evaluation | Expected: ~1000 UPSERTs in <100ms with `bun:sqlite` WAL mode; content hash skips ~95% of items |
| `bun:sqlite` API changes | Built-in to Bun, stable API; low risk |
| Non-atomic writes cause inconsistent state | Wrap ALL per-cycle writes in a single `db.transaction()` call |
| JSON serialization non-determinism causes phantom diffs | Use `microdiff` for structural comparison; sort arrays before diffing |
| Partial hydration overwrites snapshot with stale data | Track which services were hydrated; only diff/overwrite fields for those services |
| First evaluation generates 15,000+ pointless field_changes | Skip `field_changes` generation on initial insert (no previous snapshot to diff against) |

## References & Research

### Internal References
- Field registry: `src/config/field-registry.ts`
- Field resolver: `src/rules/field-resolver.ts`
- Missing data check: `src/rules/rules.service.ts` (lines 90-104)
- Media hydration: `src/media/media.service.ts`
- Media merger: `src/media/media.merger.ts`
- Radarr client: `src/radarr/radarr.client.ts`
- Radarr types: `src/radarr/radarr.types.ts`
- Unified types: `src/shared/types.ts`
- Evaluation pipeline: `src/evaluation/evaluation.service.ts`

### External References
- Radarr API: `GET /api/v3/importlist/movie` returns `ImportListMoviesResource` with `lists: number[]`
- Bun SQLite docs: https://bun.sh/docs/api/sqlite
- `bun:sqlite` supports `Database`, `Statement`, WAL mode, and typed `query<T>()` generics
- `microdiff`: Sub-1kb, zero-dependency object diffing library (TypeScript-native, MIT) — https://github.com/AsyncBanana/microdiff
- SQLite recommended PRAGMAs: https://databaseschool.com/articles/sqlite-recommended-pragmas
- SQLite performance optimization (production PRAGMAs): https://cj.rs/blog/sqlite-pragma-cheatsheet-for-performance-and-consistency/
- NestJS lifecycle hooks: `OnModuleInit`, `OnModuleDestroy`, `enableShutdownHooks()` — https://docs.nestjs.com/fundamentals/lifecycle-events
