# Brainstorm: Rule-Based Media Cleanup Engine

**Date:** 2026-02-13
**Status:** Final

## What We're Building

Roombarr is a long-running NestJS daemon that intelligently cleans up media from Sonarr and Radarr based on configurable rules. It aggregates data from four services — **Sonarr**, **Radarr**, **Jellyfin**, and **Jellyseerr** — into a unified media model, then evaluates user-defined condition groups (AND/OR logic) to determine what action to take on each media item.

The problem it solves: on a shared family media server, deciding what to delete is always "it depends." Roombarr serializes those "depends" into declarative YAML rules that run automatically.

**Atomic units:** Movies (Radarr) and Seasons (Sonarr). A series is just an aggregate of its seasons — rules always evaluate per-season for Sonarr content.

## Why This Approach

**Unified Media Model** — Roombarr merges data from all configured services into a single object per media item (matched via TMDB/TVDB IDs). A single rule can reference properties from any service without the user needing to think about where data lives.

**Condition Groups (AND/OR)** — Rules are expressed as nested condition trees with AND/OR operators. Each condition references a field path on the unified model and applies an operator (e.g., `olderThan`, `equals`, `includesAll`).

**Configurable Actions Per Rule** — Each rule specifies its own action: `delete`, `unmonitor`, or `keep`. Different situations warrant different responses.

**Least Destructive Wins** — When multiple rules match the same item, the least destructive action wins. Hierarchy: `keep > unmonitor > delete`. This is safe, consistent, and predictable.

**Dry-Run Only (v1)** — The first version only supports dry-run mode. It evaluates all rules and logs what would happen, but never executes destructive actions. Live execution will be added once the rule engine is trusted.

## Key Decisions

1. **Runtime:** Long-running NestJS daemon with API endpoints
2. **Rule engine:** AND/OR condition groups evaluated against a unified media model
3. **Data sources:** Sonarr, Radarr, Jellyfin (watch history/activity), Jellyseerr (request tracking)
4. **Atomic units:** Movies (Radarr), Seasons (Sonarr) — rules always evaluate per-season, not per-series
5. **Actions (v1):** `delete`, `unmonitor`, `keep` — dry-run only for v1
6. **Conflict resolution:** Least destructive wins: `keep > unmonitor > delete`
7. **Scheduling:** Built-in cron schedule + on-demand API endpoint (`POST /evaluate`)
8. **Configuration:** Single YAML file for everything (service connections, rules, schedule)
9. **Media matching:** TMDB/TVDB IDs to correlate items across services. Items that can't be matched are skipped with a warning.
10. **Jellyfin users:** All Jellyfin users count for `watchedBy`/`watchedByAll` computations
11. **Error handling:** If a service is unavailable, skip rules that reference its fields. Other rules still evaluate. Log a warning.
12. **Notifications:** Logging only for v1 (stdout/structured logs)
13. **State:** Stateless — each evaluation run re-evaluates everything from scratch
14. **Field syntax:** Dotted string paths (e.g., `radarr.sizeOnDisk`, `jellyfin.watchedByAll`)
15. **Missing cross-service data:** Skip the entire rule for that item with a warning (not false, not error)
16. **Config validation:** Validate at startup with Zod, refuse to run on errors (fail fast)
17. **Module structure:** One NestJS module per external service + MediaModule + RulesModule + EvaluationModule
18. **HTTP client:** @nestjs/axios
19. **Logging:** nestjs-pino (structured JSON)
20. **Scheduling:** @nestjs/schedule
21. **Testing:** Unit tests for rule engine + integration tests for API clients with fixtures
22. **YAML convention:** snake_case keys everywhere (matching Recyclarr/*arr ecosystem). Field paths also snake_case (roombarr maps internally to API camelCase).
23. **Nested conditions:** Fully supported — AND/OR groups can contain other AND/OR groups. Validated against Kyverno, Home Assistant, and json-rules-engine patterns.

## Config Shape

```yaml
# roombarr.yml

services:
  sonarr:
    base_url: http://localhost:8989
    api_key: your-api-key
  radarr:
    base_url: http://localhost:7878
    api_key: your-api-key
  jellyfin:
    base_url: http://localhost:8096
    api_key: your-api-key
  jellyseerr:
    base_url: http://localhost:5055
    api_key: your-api-key

schedule: "0 3 * * *"  # 3 AM daily

performance:
  concurrency: 10  # max parallel API calls per service

rules:
  # === PROTECTION RULES (keep always wins) ===

  - name: "Protect tagged movies"
    target: radarr
    conditions:
      operator: OR
      children:
        - field: radarr.tags
          operator: includes
          value: "permanent"
        - field: radarr.tags
          operator: includes
          value: "favorite"
    action: keep

  - name: "Protect tagged series (all seasons)"
    target: sonarr
    conditions:
      operator: OR
      children:
        - field: sonarr.tags
          operator: includes
          value: "permanent"
        - field: sonarr.tags
          operator: includes
          value: "favorite"
    action: keep

  # === MOVIE CLEANUP (radarr) ===

  - name: "Delete fully watched old movies"
    target: radarr
    conditions:
      operator: AND
      children:
        - field: jellyfin.watched_by_all
          operator: equals
          value: true
        - field: radarr.added
          operator: older_than
          value: "60d"
    action: delete

  - name: "Delete untouched movies"
    target: radarr
    conditions:
      operator: AND
      children:
        - field: jellyfin.watched_by
          operator: is_empty
        - field: radarr.added
          operator: older_than
          value: "90d"
    action: delete

  - name: "Unmonitor huge unwatched movies"
    target: radarr
    conditions:
      operator: AND
      children:
        - field: radarr.size_on_disk
          operator: greater_than
          value: 50_000_000_000  # 50 GB
        - field: jellyfin.last_played
          operator: older_than
          value: "30d"
    action: unmonitor

  - name: "Unmonitor old barely-watched requests"
    target: radarr
    conditions:
      operator: AND
      children:
        - field: jellyseerr.requested_at
          operator: older_than
          value: "90d"
        - field: jellyfin.play_count
          operator: less_than
          value: 2
    action: unmonitor

  # === SEASON CLEANUP (sonarr) ===

  - name: "Delete stale seasons"
    target: sonarr
    conditions:
      operator: AND
      children:
        - field: jellyfin.last_played
          operator: older_than
          value: "180d"
        - field: sonarr.season.episode_file_count
          operator: greater_than
          value: 0
    action: delete

  # === NESTED CONDITION EXAMPLE ===

  # Delete movies that are (watched by all OR untouched for 6 months)
  # AND (tagged seasonal OR added more than 90 days ago)
  - name: "Clean up seasonal or old watched movies"
    target: radarr
    conditions:
      operator: AND
      children:
        - operator: OR
          children:
            - field: jellyfin.watched_by_all
              operator: equals
              value: true
            - field: jellyfin.last_played
              operator: older_than
              value: "180d"
        - operator: OR
          children:
            - field: radarr.tags
              operator: includes
              value: "seasonal"
            - field: radarr.added
              operator: older_than
              value: "90d"
    action: delete
```

## Value Types

Values in conditions use native YAML types with one extension for durations:

| Type | Examples | Notes |
|------|----------|-------|
| **Number** | `5.0`, `20_000_000_000` | Native YAML numbers. File sizes in bytes. |
| **String** | `"permanent"`, `"1080p"` | Native YAML strings. |
| **Boolean** | `true`, `false` | Native YAML booleans. |
| **Duration** | `"30d"`, `"6m"`, `"1y"` | String parsed as relative duration. Units: `d` (days), `w` (weeks), `m` (months), `y` (years). Used with `older_than`/`newer_than`. |
| **String[]** | `["Jackson", "Partner"]` | YAML arrays. Used with `includes_all`. |

File sizes are always in bytes (no unit parsing). Use YAML's `_` separator for readability: `20_000_000_000`.

## Unified Media Model (Conceptual)

### Radarr — one model per movie

```
UnifiedMovie {
  tmdbId, imdbId, title, year

  radarr: { added, sizeOnDisk, qualityProfile, tags, genres,
            ratings: { tmdb }, monitored, status, path }

  jellyfin: { watchedBy: string[], watchedByAll: boolean,
              lastPlayed: Date | null, playCount: number }

  jellyseerr: { requestedBy: string, requestedAt: Date,
                requestStatus: string } | null
}
```

### Sonarr — one model per season

```
UnifiedSeason {
  tvdbId, title, year

  sonarr: { tags, genres, status, path,  // series-level
            season: { seasonNumber, monitored, episodeCount,
                      episodeFileCount, sizeOnDisk } }  // season-level

  jellyfin: { watchedBy: string[], watchedByAll: boolean,
              lastPlayed: Date | null, playCount: number }  // season-level

  jellyseerr: { requestedBy: string, requestedAt: Date,
                requestStatus: string } | null  // series-level
}
```

**Note on derived fields:**
- `watchedByAll` is computed by roombarr — Jellyfin doesn't expose it. Roombarr queries all Jellyfin users' play status and intersects the results.
- `watchedBy` is an array of Jellyfin usernames (`Name` field from `/Users`).
- `lastPlayed` is the most recent `LastPlayedDate` across all users. Caveat: Jellyfin only updates this on actual playback start, NOT when marking items as watched via API.
- **Season-level Jellyfin data** is aggregated from episodes — Jellyfin has no native season watch status. Roombarr queries episodes per season per user and computes: `watchedBy` = users who played all episodes, `playCount` = min play count across episodes, `lastPlayed` = max LastPlayedDate across episodes.

**Note on tags:**
- Sonarr/Radarr store tags as integer ID arrays (e.g., `[1, 3, 5]`). Roombarr resolves tag names from config to IDs at startup via `GET /api/v3/tag`. If a tag name from config doesn't exist, startup fails with an error.
- The `includes` operator on `tags` compares against resolved tag names (roombarr handles the ID→name mapping internally).

## Available Condition Properties (v1)

All field paths use snake_case. Roombarr maps these to the actual API property names internally.

### Radarr (target: radarr)
- **Dates:** `radarr.added` (datetime), `radarr.digital_release` (datetime), `radarr.physical_release` (datetime)
- **Size:** `radarr.size_on_disk` (number, bytes)
- **Metadata:** `radarr.monitored` (boolean), `radarr.tags` (string[], resolved from IDs), `radarr.genres` (string[]), `radarr.status` (string: "tba"|"announced"|"released"), `radarr.year` (number), `radarr.has_file` (boolean)

### Sonarr (target: sonarr)
- **Series-level:** `sonarr.tags` (string[], resolved from IDs), `sonarr.genres` (string[]), `sonarr.status` (string: "continuing"|"ended"), `sonarr.year` (number)
- **Season-level:** `sonarr.season.monitored` (boolean), `sonarr.season.season_number` (number), `sonarr.season.episode_count` (number), `sonarr.season.episode_file_count` (number), `sonarr.season.size_on_disk` (number, bytes)

### Jellyfin (aggregated from episodes for Sonarr seasons)
- `jellyfin.watched_by` (string[]) — usernames who watched all episodes
- `jellyfin.watched_by_all` (boolean) — true if all Jellyfin users watched it
- `jellyfin.last_played` (date) — most recent play across all users
- `jellyfin.play_count` (number) — minimum play count across episodes (for seasons)

### Jellyseerr
- `jellyseerr.requested_by` (string) — username of requester
- `jellyseerr.requested_at` (date) — ISO 8601 creation timestamp
- `jellyseerr.request_status` (string: "pending"|"approved"|"declined"|"available")

**Removed from v1:** `radarr.ratings.*` and `radarr.quality_profile` — ratings structure varies and needs real-instance verification. Will revisit in v2.

## Condition Operators (v1)

All operators use snake_case.

| Operator | Applies to | Description |
|----------|-----------|-------------|
| `equals` | any | Exact match |
| `not_equals` | any | Not equal |
| `greater_than` | number | Numeric greater than |
| `less_than` | number | Numeric less than |
| `older_than` | date | Date is more than duration ago |
| `newer_than` | date | Date is less than duration ago |
| `includes` | array | Array contains value |
| `not_includes` | array | Array does not contain value |
| `includes_all` | array | Array contains all specified values |
| `is_empty` | array | Array has no elements |
| `is_not_empty` | array | Array has at least one element |

## Data Hydration Strategy

Evaluation runs follow this sequence:
1. **Analyze rules** — determine which services are referenced by active rules (lazy evaluation)
2. **Fetch bulk data** only from services that rules actually reference (skip unused + unavailable ones)
3. **Index by external IDs** — Sonarr by TVDB ID, Radarr by TMDB ID, Jellyfin by provider IDs, Jellyseerr by TMDB ID
4. **Merge into unified models** — match across services using TMDB/TVDB IDs
5. **Compute derived fields** — `watchedByAll`, `watchedBy`, `lastPlayed` aggregated from per-user Jellyfin queries
6. **Evaluate rules** — for each unified item, check all rules, collect matching actions, apply least-destructive-wins
7. **Log results** — structured output of what would happen (dry-run)

**Jellyfin hydration (movies):** For each user, `GET /Users/{userId}/Items?Filters=IsPlayed&IncludeItemTypes=Movie&Recursive=true`. Index by `ProviderIds.Tmdb`. For N users, this is N paginated API calls.

**Jellyfin hydration (seasons):** More expensive. For each Sonarr series matched to Jellyfin, query episodes per season per user: `GET /Users/{userId}/Items?ParentId={seasonId}&IncludeItemTypes=Episode`. Aggregate `UserData.Played` across episodes to compute season-level `watchedBy`. For S series with K avg seasons and N users, this is roughly S × K × N calls (mitigated by only querying series that have Sonarr rules targeting them).

**Jellyseerr hydration:** Fetch all requests via paginated `GET /request` (uses `skip`/`take`). Index by `media.tmdbId`. Requests contain `requestedBy.username` and `createdAt`.

**Tag resolution:** At startup, fetch `GET /api/v3/tag` from Sonarr and Radarr. Build name→ID maps. Validate all tag names in config exist. Internally, conditions on `tags` compare resolved names.

**Cross-service matching:** Radarr items match Jellyfin/Jellyseerr via TMDB ID. Sonarr items match Jellyfin via TVDB ID (from `ProviderIds.Tvdb`). Sonarr→Jellyseerr matching uses TVDB ID where available.

**Unmatched items:** Items that can't be correlated across services (missing external IDs) are skipped with a warning for rules that reference the unmatched service's fields.

## Performance Strategy

**Lazy data fetching:** Before making any API calls, analyze the rule set to determine which services are actually referenced. If no rules use `jellyfin.*` fields, Jellyfin is never queried. If no rules target `sonarr`, Sonarr data is never fetched. This eliminates unnecessary work entirely.

**Bounded concurrency:** Jellyfin season hydration (the expensive path) runs API calls in parallel with a configurable concurrency limit. Default: 10 concurrent requests. Configurable in YAML:
```yaml
performance:
  concurrency: 10  # max parallel API calls to any single service
```

**Cost estimates (5 users, 100 series, 4 avg seasons):**
- Radarr + Jellyfin (movies only): ~10 API calls total (fast)
- Sonarr + Jellyfin (seasons): ~2,000 calls at 10 concurrency = ~10 seconds wall-clock
- All services: ~2,050 calls, dominated by season aggregation

## Edge Cases

**New/downloading media:** No special handling. Rules naturally protect new media via conditions like `added olderThan 30d`. Items with no files simply won't match size-based conditions.

**Missing cross-service data:** If a rule references a service's fields (e.g., `jellyfin.watchedByAll`) but that data doesn't exist for an item (no matching ID, or not in that service), the **entire rule is skipped for that item** with a warning. This applies uniformly — whether the item has no Jellyfin match, no Jellyseerr request, etc. This is critical for safety: a `keep` rule referencing missing data should not silently fail to protect an item.

**Partial seasons:** Sonarr seasons with fewer files than episodes are still evaluated normally. The `episodeFileCount` and `episodeCount` fields are available for rules that want to distinguish partial from complete seasons.

**Config validation:** Roombarr validates the entire config at startup and **refuses to run** if there are errors. This includes: unknown field paths, operator/type mismatches (e.g., `olderThan` on an array field), invalid duration formats, and malformed YAML. Fail fast, fail loud.

**Evaluation scope:** Rules with `target: radarr` only evaluate items that exist in Radarr. Rules with `target: sonarr` only evaluate seasons that exist in Sonarr. Cross-service data enriches these items but never introduces new ones.

## Architecture

**Module structure (one module per service):**
- `ConfigModule` — loads and validates YAML config (Zod schemas)
- `SonarrModule` — Sonarr API client and data mapping
- `RadarrModule` — Radarr API client and data mapping
- `JellyfinModule` — Jellyfin API client, per-user query aggregation, derived field computation
- `JellyseerrModule` — Jellyseerr API client and request mapping
- `MediaModule` — Unified model hydration, cross-service merging via TMDB/TVDB IDs
- `RulesModule` — Rule engine: condition evaluation, operator logic, conflict resolution
- `EvaluationModule` — Orchestrates a full evaluation run (fetch → merge → evaluate → log). Exposes `POST /evaluate` endpoint and cron trigger.

**Key libraries:**
- **HTTP:** `@nestjs/axios` (Axios wrapper with DI integration)
- **Validation:** `zod` (config schema validation + TypeScript type inference)
- **Scheduling:** `@nestjs/schedule` (cron-based evaluation triggers)
- **Logging:** `nestjs-pino` (structured JSON logging via Pino)
- **YAML:** `js-yaml` or `yaml` (config file parsing)

**Testing:**
- **Unit tests:** Rule engine (condition evaluation, operator logic, conflict resolution, edge cases). Mocked API clients.
- **Integration tests:** Each API client with recorded response fixtures. Verifies data mapping from real API shapes to unified model.

## Deployment

**Docker image:** LinuxServer.io-style conventions for native Unraid/TrueNAS integration:
- Base: Alpine Linux (via `node:alpine` or LSIO base image)
- Environment variables: `PUID`, `PGID` for user/group mapping, `TZ` for timezone
- Volume mount: `/config` — contains `roombarr.yml` and log output
- Config path: `/config/roombarr.yml` (also configurable via `CONFIG_PATH` env var)
- Port: 3000 (for the API endpoint)
- Process management: s6-overlay (standard for LSIO-style images)

**Docker Compose example:**
```yaml
roombarr:
  image: roombarr/roombarr:latest
  container_name: roombarr
  environment:
    - PUID=1000
    - PGID=1000
    - TZ=America/New_York
  volumes:
    - /path/to/roombarr/config:/config
  ports:
    - 3000:3000
  restart: unless-stopped
```

**Config file loading priority:**
1. `CONFIG_PATH` environment variable (if set)
2. `/config/roombarr.yml` (default container path)
3. `./roombarr.yml` (for local development)

## Resolved Questions

1. **Rule ordering and conflicts:** Least destructive wins: `keep > unmonitor > delete`.
2. **Series granularity:** Seasons are the atomic unit for Sonarr. Rules always evaluate per-season.
3. **Notifications:** Logging only for v1.
4. **Jellyfin users:** All Jellyfin users count. No user filtering for v1.
5. **Service unavailability:** Skip rules that depend on the unavailable service. Other rules still run.
6. **Value types:** Native YAML types + duration strings. File sizes in bytes.
7. **Actions for v1:** `delete`, `unmonitor`, `keep` only. Compound actions (exclude, blocklist) deferred to v2.
8. **Jellyfin season aggregation:** Computed from episodes (all episodes played = season watched by that user).
9. **Tag resolution:** Auto-resolve tag names to IDs at startup; fail if tag doesn't exist.
10. **Ratings:** Dropped from v1 — API structure needs real-instance verification.
11. **Sonarr→Jellyseerr matching:** Via TVDB ID (Sonarr's primary ID). Jellyseerr also uses TMDB for TV but TVDB is more reliable for Sonarr items.
