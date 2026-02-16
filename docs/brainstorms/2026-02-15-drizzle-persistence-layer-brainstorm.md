---
date: 2026-02-15
topic: drizzle-persistence-layer
---

# Drizzle ORM Persistence Layer

## What We're Building

Migrate the existing raw `bun:sqlite` persistence layer to Drizzle ORM (`drizzle-orm/bun-sql`) while preserving and improving the two-table model: a `media_items` table for latest state and a `field_changes` table as a generic append-only temporal log. The field_changes log is the backbone of the system's temporal intelligence — it lets rules consider historical media state (e.g., "was this movie on an import list 30 days ago?") that the upstream APIs (Radarr, Sonarr, Jellyfin, Jellyseerr) don't track.

The persistence layer must be extensible enough for open-source community use. Users should be able to write temporal rules against any tracked field without schema changes or code modifications.

## Why This Approach

Three approaches were considered:

1. **Purpose-built columns** (e.g., `last_on_import_list_at`, `first_watched_at`) — Simple and fast for known rules, but every new temporal question requires a schema migration. Unacceptable for an open-source project where users define their own rules.

2. **Full time-series snapshots** (one row per item per evaluation) — Maximum queryability, but storage growth scales linearly with library size and evaluation frequency. Overkill for the queries we need.

3. **Latest-state table + generic change log** (chosen) — Captures everything without prejudice about what's important. Users can ask temporal questions about any field. Slightly more work to query than purpose-built columns, but the extensibility justifies it.

## Key Decisions

- **Drizzle ORM via `drizzle-orm/bun-sql`**: Replaces raw `bun:sqlite`. Provides type-safe schema definitions, query building, and migration management (`drizzle-kit`). Replaces the manual `PRAGMA user_version` migration system.

- **Keep the two-table model (`media_items` + `field_changes`)**: The generic change log is the right foundation for community extensibility. Any field tracked by the field registry automatically gets temporal history.

- **Fix retention policy**: The current 90-day hard deletion of change log entries can silently break rules that need longer lookback windows (e.g., "off import list for 120 days"). Retention should be configurable or removed entirely — a home media server with ~1000 items generates trivially small change volume.

- **Batch state computation**: Replace the current N+1 query pattern in `StateService` (2 SQL queries per movie) with a single batch query that loads all relevant changes, then indexes in memory. This scales to any number of state fields.

- **Data-driven state field computation**: Instead of handwritten methods per temporal field (`computeDaysOffImportList`, `computeEverOnImportList`), define temporal patterns as registry entries:
  - `days_since_value` — "how many days since field X became value Y?"
  - `ever_was_value` — "was field X ever value Y?"
  - `days_since_changed` — "how many days since field X last changed?"
  - New patterns can be added without rewriting query logic.

- **`media_items` replaces `media_snapshots`**: Same concept, renamed for clarity. Adds `last_seen_at` alongside existing `first_seen_at`. Keeps `data` JSON blob + `data_hash` for diff optimization. Keeps `missed_evaluations` for orphan cleanup.

## Schema Overview

### `media_items` (replaces `media_snapshots`)

| Column | Type | Purpose |
|--------|------|---------|
| media_type | text, PK | 'movie' or 'season' |
| media_id | text, PK | tmdb_id (movies) or tvdb_id:season_number (seasons) |
| title | text | Human-readable title |
| data | text | JSON blob of latest flattened field state |
| data_hash | text | Content hash for skip-if-unchanged optimization |
| first_seen_at | text | ISO timestamp, set once on first observation |
| last_seen_at | text | ISO timestamp, updated every evaluation |
| missed_evaluations | integer | Consecutive evaluations where item was absent |

### `field_changes` (kept, improved)

| Column | Type | Purpose |
|--------|------|---------|
| id | integer, PK | Auto-increment |
| media_type | text | FK to media_items |
| media_id | text | FK to media_items |
| field_path | text | Dotted field path (e.g., 'radarr.on_import_list') |
| old_value | text, nullable | JSON-serialized previous value |
| new_value | text, nullable | JSON-serialized new value |
| changed_at | text | ISO timestamp |

Indexes: `(media_type, media_id, field_path)` for temporal lookups, `(changed_at)` for optional retention cleanup.

## Target Rules This Enables

| Rule | Mechanism |
|------|-----------|
| Keep if on import list or was within 30 days | `state.days_off_import_list` < 30 (derived from field_changes on `radarr.on_import_list`) |
| Keep if requested within 3 months | `jellyseerr.requested_at` + `newer_than: 3m` (live API data, no persistence needed) |
| Keep if ever watched | `state.ever_watched` (derived from field_changes on `jellyfin.watched_by`) |

## Resolved Questions

- **Watched threshold**: Jellyfin's built-in `Played` boolean is sufficient — Jellyfin already applies its own completion threshold (~90%) per item. No custom percentage tracking needed. The only adjustment is the season aggregation: change from requiring 100% of episodes played to 80% of episodes played. This is a Jellyfin aggregator concern, not a persistence concern.

- **State field extensibility UX**: Plugin-style registry (option B). The codebase ships with built-in state fields, but the architecture makes it trivial for contributors to add new ones — a single registry entry declaring the tracked field, target value, and computation pattern. A 5-line PR, no deep system knowledge required. Can be promoted to user-defined YAML config later if community demand exists.

- **Retention configuration**: No retention by default — keep all field_changes indefinitely. Napkin math: ~1000 items, daily evaluation, ~5-10% change rate = ~25-35K rows/year = ~7 MB/year. Negligible on a machine running media servers. No retention config knob for v1; can be added later if someone requests it.

## Next Steps

-> `/workflows:plan` for Drizzle migration implementation details
