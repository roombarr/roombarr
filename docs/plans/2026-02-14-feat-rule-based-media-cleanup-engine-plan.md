---
title: "feat: Rule-Based Media Cleanup Engine"
type: feat
status: active
date: 2026-02-14
brainstorm: docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md
---

# Rule-Based Media Cleanup Engine (v1)

## Overview

Build roombarr's core functionality: a NestJS daemon that loads YAML-configured rules, fetches media data from Sonarr/Radarr/Jellyfin/Jellyseerr, evaluates conditions against a unified media model, and logs what actions would be taken (dry-run only).

**Brainstorm reference:** `docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md`

## Problem Statement

On a shared family media server, deciding what media to delete is always "it depends." Different content has different retention rules: watched by everyone → safe to delete, tagged as favorite → keep forever, requested 6 months ago and never watched → probably delete. These decisions require cross-referencing multiple services (Sonarr, Radarr, Jellyfin, Jellyseerr) and applying nuanced logic that varies per household. Currently this is done manually.

## Proposed Solution

A declarative YAML rule engine that automates the "should I delete this?" decision. Rules are expressed as AND/OR condition trees that can reference properties from any configured service. The system fetches data from all services, merges it into a unified model per media item, evaluates all rules, and resolves conflicts using a "least destructive wins" hierarchy (`keep > unmonitor > delete`).

v1 is dry-run only — it logs what would happen but never executes destructive actions.

## Technical Approach

### Architecture

```
                    ┌─────────────────────┐
                    │   roombarr.yml      │
                    │   (YAML config)     │
                    └────────┬────────────┘
                             │ startup
                    ┌────────▼────────────┐
                    │    ConfigModule      │
                    │  (Zod validation)    │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼──────┐  ┌───▼────────┐
     │ScheduleModule│  │EvaluationModule│  │HealthModule│
     │  (cron)    │  │ POST /evaluate │  │ GET /health│
     └────────┬───┘  └──────┬──────┘  └────────────┘
              │              │
              └──────┬───────┘
                     │ trigger
              ┌──────▼──────┐
              │ MediaModule  │
              │ (hydration)  │
              └──────┬──────┘
                     │ fetches from
      ┌──────┬───────┼───────┬──────────┐
      │      │       │       │          │
  ┌───▼──┐ ┌▼────┐ ┌▼─────┐ ┌▼────────┐ │
  │Sonarr│ │Radarr│ │Jelly-│ │Jelly-   │ │
  │Module│ │Module│ │fin   │ │seerr    │ │
  └──────┘ └─────┘ │Module│ │Module   │ │
                    └──────┘ └─────────┘ │
                                         │
                                  ┌──────▼──────┐
                                  │ RulesModule  │
                                  │ (engine)     │
                                  └─────────────┘
```

**Module inventory:**
- `ConfigModule` — YAML loading, Zod schema validation, config service
- `SonarrModule` — Sonarr v3 API client, series/season data mapping, tag resolution
- `RadarrModule` — Radarr v3 API client, movie data mapping, tag resolution
- `JellyfinModule` — Jellyfin API client, user enumeration, watch data aggregation, derived field computation
- `JellyseerrModule` — Jellyseerr API client, paginated request fetching, TMDB/TVDB indexing
- `MediaModule` — Cross-service merging into UnifiedMovie/UnifiedSeason models
- `RulesModule` — Condition evaluation, operator registry, conflict resolution
- `EvaluationModule` — Orchestrates evaluation runs, exposes API endpoints, manages run state
- `HealthModule` — `GET /health` endpoint for container orchestration

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Already configured in project |
| Linter | Biome | Already configured; no `any`, no default exports, named exports only |
| HTTP client | @nestjs/axios | NestJS-integrated, DI-friendly |
| Config validation | Zod | Type inference + runtime validation, single source of truth |
| YAML parsing | `yaml` (npm) | Modern, well-maintained, YAML 1.2 compliant |
| Scheduling | @nestjs/schedule | NestJS-integrated cron scheduling |
| Logging | nestjs-pino | Structured JSON logging, fast |
| Tests | Bun native (`bun:test`) | Already configured; colocated `.test.ts` files |
| YAML convention | snake_case everywhere | Matches *arr ecosystem (Recyclarr) |

### Implementation Phases

#### Phase 1: Config + Rule Engine (Foundation)

**Goal:** Load and validate YAML config, build the rule engine with all operators, test thoroughly. No external API calls yet.

**Files to create:**

```
src/
  config/
    config.module.ts          # NestJS module, exports ConfigService
    config.service.ts         # Loads YAML, validates with Zod, provides typed config
    config.schema.ts          # Zod schemas for entire config (services, rules, etc.)
    config.service.test.ts    # Validation tests with valid/invalid configs
  rules/
    rules.module.ts           # NestJS module, exports RulesService
    rules.service.ts          # Evaluates rules against unified models
    rules.service.test.ts     # Unit tests for all operators, nesting, conflicts
    operators.ts              # Operator registry: functions keyed by operator name
    operators.test.ts         # Unit tests for each operator in isolation
    field-resolver.ts         # Resolves dotted field paths to values on models
    field-resolver.test.ts    # Field resolution tests including nested paths
    types.ts                  # TypeScript types: Rule, Condition, ConditionGroup, Action, etc.
```

**Config schema (Zod):**

```typescript
// config.schema.ts
import { z } from 'zod';

const serviceConfigSchema = z.object({
  base_url: z.string().url(),
  api_key: z.string().min(1),
});

const conditionOperatorSchema = z.enum([
  'equals', 'not_equals',
  'greater_than', 'less_than',
  'older_than', 'newer_than',
  'includes', 'not_includes', 'includes_all',
  'is_empty', 'is_not_empty',
]);

const leafConditionSchema = z.object({
  field: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  operator: conditionOperatorSchema,
  value: z.union([
    z.string(), z.number(), z.boolean(),
    z.array(z.string()),
  ]).optional(), // optional for is_empty/is_not_empty
});

// Recursive schema for nested AND/OR groups
const conditionGroupSchema: z.ZodType = z.lazy(() =>
  z.object({
    operator: z.enum(['AND', 'OR']),
    children: z.array(
      z.union([leafConditionSchema, conditionGroupSchema])
    ).min(1),
  })
);

const conditionSchema = z.union([leafConditionSchema, conditionGroupSchema]);

const ruleSchema = z.object({
  name: z.string().min(1),
  target: z.enum(['sonarr', 'radarr']),
  conditions: conditionGroupSchema,
  action: z.enum(['delete', 'unmonitor', 'keep']),
});

const performanceSchema = z.object({
  concurrency: z.number().int().min(1).max(50).default(10),
}).default({});

export const configSchema = z.object({
  services: z.object({
    sonarr: serviceConfigSchema.optional(),
    radarr: serviceConfigSchema.optional(),
    jellyfin: serviceConfigSchema.optional(),
    jellyseerr: serviceConfigSchema.optional(),
  }).refine(
    data => data.sonarr || data.radarr,
    'At least one of sonarr or radarr must be configured'
  ),
  schedule: z.string().min(1),
  performance: performanceSchema,
  rules: z.array(ruleSchema).min(1),
});

export type RoombarrConfig = z.infer<typeof configSchema>;
```

**Config validation rules (beyond Zod schema):**
- Rules targeting `sonarr` require `services.sonarr` to be configured
- Rules targeting `radarr` require `services.radarr` to be configured
- Rules referencing `jellyfin.*` fields require `services.jellyfin` to be configured
- Rules referencing `jellyseerr.*` fields require `services.jellyseerr` to be configured
- `is_empty`/`is_not_empty` operators must not have a `value` field
- All other operators must have a `value` field
- `older_than`/`newer_than` values must be valid duration strings (`/^\d+[dwmy]$/`)
- Field paths must exist in the known field registry for the rule's target
- Operator must be compatible with the field's type (e.g., `older_than` only on date fields)

**Operator registry:**

```typescript
// operators.ts — each operator is a pure function
export const operators: Record<string, (fieldValue: unknown, conditionValue: unknown) => boolean> = {
  equals: (field, value) => field === value,
  not_equals: (field, value) => field !== value,
  greater_than: (field, value) => (field as number) > (value as number),
  less_than: (field, value) => (field as number) < (value as number),
  older_than: (field, value) => {
    // null dates = infinitely old = always matches older_than
    if (field === null || field === undefined) return true;
    const threshold = subtractDuration(new Date(), parseDuration(value as string));
    return new Date(field as string) < threshold;
  },
  newer_than: (field, value) => {
    if (field === null || field === undefined) return false;
    const threshold = subtractDuration(new Date(), parseDuration(value as string));
    return new Date(field as string) > threshold;
  },
  includes: (field, value) => (field as unknown[]).includes(value),
  not_includes: (field, value) => !(field as unknown[]).includes(value),
  includes_all: (field, value) =>
    (value as unknown[]).every(v => (field as unknown[]).includes(v)),
  is_empty: field => (field as unknown[]).length === 0,
  is_not_empty: field => (field as unknown[]).length > 0,
};
```

**Null date semantics:** `older_than` on null returns `true` (infinitely old). `newer_than` on null returns `false` (can't be newer than anything if never played).

**Rule evaluation algorithm:**

```
for each item in unified models:
  matched_actions = []
  for each rule in rules:
    if rule.target !== item.type: skip
    services_needed = extract_service_prefixes(rule.conditions)
    for service in services_needed:
      if service data is missing for this item:
        skip rule for this item, log warning
        continue to next rule
    if evaluate_conditions(rule.conditions, item):
      matched_actions.push(rule.action)
  resolved_action = least_destructive(matched_actions)
  // keep > unmonitor > delete
  log(item, matched_actions, resolved_action)
```

**Acceptance criteria (Phase 1):**
- [x] YAML config loads from file path priority chain
- [x] Zod validation catches all invalid configs with clear error messages
- [x] Rules targeting unconfigured services fail validation at startup
- [x] Rules referencing unconfigured enrichment services fail validation at startup
- [x] All 11 operators work correctly with unit tests
- [x] Nested AND/OR conditions evaluate correctly (3+ levels deep)
- [x] Null date fields evaluate as infinitely old for `older_than`
- [x] `is_empty`/`is_not_empty` work without `value` field
- [x] Least-destructive-wins conflict resolution works (`keep > unmonitor > delete`)
- [x] Field resolver handles dotted paths (`sonarr.season.episode_file_count`)
- [x] Duration parser handles `d`, `w`, `m`, `y` units
- [x] Config service is injectable and provides typed config throughout the app

---

#### Phase 2: Sonarr + Radarr Integration

**Goal:** Fetch real data from Sonarr and Radarr APIs, map to domain models, resolve tags.

**Files to create:**

```
src/
  sonarr/
    sonarr.module.ts
    sonarr.client.ts          # Low-level API calls (GET /series, GET /tag, etc.)
    sonarr.client.test.ts     # Integration tests with recorded API fixtures
    sonarr.mapper.ts          # Maps Sonarr API DTOs → domain model fields
    sonarr.mapper.test.ts
    sonarr.service.ts         # Orchestrates client + mapper
    sonarr.types.ts           # Sonarr API response DTOs
  radarr/
    radarr.module.ts
    radarr.client.ts
    radarr.client.test.ts
    radarr.mapper.ts
    radarr.mapper.test.ts
    radarr.service.ts
    radarr.types.ts
  shared/
    types.ts                  # UnifiedMovie, UnifiedSeason, shared interfaces
    duration.ts               # Duration parsing utilities
    duration.test.ts
```

**Sonarr data flow:**
1. `GET /api/v3/series` → all series with embedded `seasons[]` array
2. `GET /api/v3/tag` → tag ID→name map
3. For each series, expand each season into a partial `UnifiedSeason`:
   - Series-level: `tags` (resolved to names), `genres`, `status`, `year`, `tvdbId`, `title`, `path`
   - Season-level: `seasonNumber`, `monitored`, `episodeCount`, `episodeFileCount`, `sizeOnDisk` (from `statistics`)

**Radarr data flow:**
1. `GET /api/v3/movie` → all movies
2. `GET /api/v3/tag` → tag ID→name map
3. Map each movie to a partial `UnifiedMovie`:
   - `tmdbId`, `imdbId`, `title`, `year`
   - `added`, `sizeOnDisk`, `monitored`, `status`, `tags` (resolved), `genres`, `hasFile`, `path`
   - `digitalRelease`, `physicalRelease`

**Tag resolution at startup:**
- Fetch tags from each configured *arr service
- Build `Map<string, number>` (name→ID) per service
- Validate all tag names referenced in rules exist
- Store resolved maps for condition evaluation (conditions compare against name strings; the mapping is used when building the unified model to convert IDs→names)

**Acceptance criteria (Phase 2):**
- [ ] Sonarr client fetches series and tags with proper API key header
- [ ] Radarr client fetches movies and tags with proper API key header
- [ ] Tag names in rules are validated against actual tags at startup
- [ ] Tag IDs in API responses are resolved to tag names in unified models
- [ ] Sonarr series expand into per-season models with correct field mapping
- [ ] Radarr movies map to UnifiedMovie with all condition-relevant fields
- [ ] API fixtures cover normal responses and edge cases (empty library, missing fields)
- [ ] Base URL normalization (trailing slash handling)
- [ ] HTTP timeout of 30s per request (configurable later)

---

#### Phase 3: Jellyfin Integration

**Goal:** Fetch watch data from Jellyfin, aggregate to season level, compute derived fields.

**Files to create:**

```
src/
  jellyfin/
    jellyfin.module.ts
    jellyfin.client.ts        # Low-level API calls
    jellyfin.client.test.ts
    jellyfin.aggregator.ts    # Season-level aggregation from episodes
    jellyfin.aggregator.test.ts
    jellyfin.service.ts       # Orchestrates user enumeration + data fetching
    jellyfin.types.ts         # Jellyfin API response DTOs
```

**Jellyfin data flow (movies):**
1. `GET /Users` → enumerate all active (non-disabled) users
2. For each user: `GET /Users/{userId}/Items?Filters=IsPlayed&IncludeItemTypes=Movie&Recursive=true`
3. Index played movies by `ProviderIds.Tmdb`
4. Compute per-movie: `watched_by` (usernames), `watched_by_all`, `last_played`, `play_count`

**Jellyfin data flow (seasons) — expensive path:**
1. For each Sonarr series matched to Jellyfin (via TVDB ID):
   - Find the Jellyfin series item via `GET /Users/{userId}/Items?IncludeItemTypes=Series&Recursive=true` (cached per user)
   - For each season of the series, get episodes: `GET /Users/{userId}/Items?ParentId={seasonId}&IncludeItemTypes=Episode`
   - Aggregate per-season per-user: `Played` status, `PlayCount`, `LastPlayedDate`
2. Compute season-level: `watched_by` = users who played ALL episodes in Jellyfin for that season, `play_count` = min across episodes, `last_played` = max across episodes

**Bounded concurrency:** Use a semaphore/pool pattern (e.g., `p-limit` or manual Promise pool) with `performance.concurrency` limit for all Jellyfin API calls.

**Derived field computation:**
- `watched_by`: array of usernames (Jellyfin `Name` field) who have played the item
- `watched_by_all`: true if `watched_by.length === total active users`
- `last_played`: max `LastPlayedDate` across all users (null if never played by anyone)
- `play_count`: for movies, sum across users; for seasons, min `PlayCount` across episodes then sum across users

**Acceptance criteria (Phase 3):**
- [ ] User enumeration filters out disabled users (`IsDisabled: true`)
- [ ] Movie watch data aggregated correctly across all users
- [ ] Season watch data aggregated from episodes (not series-level)
- [ ] `watched_by_all` correctly reflects all active users
- [ ] Null `LastPlayedDate` handled (never-played items have null `last_played`)
- [ ] Bounded concurrency limits parallel Jellyfin API calls
- [ ] Pagination handled for large Jellyfin libraries
- [ ] Integration tests with recorded API fixtures

---

#### Phase 4: Jellyseerr Integration + Unified Model Merge

**Goal:** Fetch request data from Jellyseerr, merge all service data into unified models.

**Files to create:**

```
src/
  jellyseerr/
    jellyseerr.module.ts
    jellyseerr.client.ts
    jellyseerr.client.test.ts
    jellyseerr.mapper.ts
    jellyseerr.mapper.test.ts
    jellyseerr.service.ts
    jellyseerr.types.ts
  media/
    media.module.ts
    media.service.ts          # Orchestrates hydration from all services
    media.service.test.ts
    media.merger.ts           # Cross-service ID matching and merging
    media.merger.test.ts
```

**Jellyseerr data flow:**
1. Paginate through `GET /api/v1/request` (using `skip`/`take`, page size 50)
2. For each request, extract: `media.tmdbId`, `media.tvdbId`, `media.mediaType`, `requestedBy.username`, `createdAt`, `status`
3. Build two indexes: `Map<number, JellyseerrRequest>` keyed by TMDB ID and by TVDB ID
4. Radarr items match via TMDB ID; Sonarr items match via TVDB ID

**Cross-service merge (MediaService):**

```
1. Analyze rules → determine needed services
2. Fetch data from needed services (parallel where independent)
3. Build unified models:
   For Radarr movies:
     - Start with Radarr data (always present)
     - Enrich with Jellyfin movie data (match by TMDB ID)
     - Enrich with Jellyseerr data (match by TMDB ID)
   For Sonarr seasons:
     - Start with Sonarr season data (always present)
     - Enrich with Jellyfin season data (match by TVDB ID)
     - Enrich with Jellyseerr data (match by TVDB ID)
4. Return unified models for rule evaluation
```

**Acceptance criteria (Phase 4):**
- [ ] Jellyseerr pagination fetches all requests (not just first page)
- [ ] Dual indexing by TMDB and TVDB ID for Jellyseerr data
- [ ] Radarr movies enriched with Jellyfin + Jellyseerr data where matched
- [ ] Sonarr seasons enriched with Jellyfin + Jellyseerr data where matched
- [ ] Unmatched items (missing cross-service IDs) produce warnings but don't error
- [ ] Lazy fetching: services not referenced by any rule are not queried
- [ ] Service unavailability handled gracefully (skip, warn, continue)

---

#### Phase 5: Evaluation Orchestration + API

**Goal:** Wire everything together. Cron scheduling, API endpoints, structured logging.

**Files to create:**

```
src/
  evaluation/
    evaluation.module.ts
    evaluation.controller.ts  # POST /evaluate, GET /evaluate/:runId
    evaluation.service.ts     # Orchestrates: fetch → merge → evaluate → log
    evaluation.service.test.ts
    evaluation.types.ts       # EvaluationRun, EvaluationResult, ItemResult
  health/
    health.module.ts
    health.controller.ts      # GET /health
```

**Evaluation flow:**
1. Trigger (cron or POST /evaluate)
2. Concurrency guard: if evaluation is running, reject (POST returns 409, cron logs warning and skips)
3. Create in-memory EvaluationRun with unique ID and `status: running`
4. POST /evaluate returns 202 with `{ run_id, status: "running" }`
5. MediaService hydrates unified models
6. RulesService evaluates all rules against all models
7. Results stored in-memory on the EvaluationRun
8. Log structured summary via Pino
9. Mark run as `status: completed`
10. GET /evaluate/:runId returns the run's results (or 404 if expired)

**In-memory run storage:** Keep last N runs (default 10) in a simple array. No persistence needed for v1.

**POST /evaluate response:**

```json
{ "run_id": "abc123", "status": "running" }
```

**GET /evaluate/:runId response (completed):**

```json
{
  "run_id": "abc123",
  "status": "completed",
  "started_at": "2026-02-14T03:00:00Z",
  "completed_at": "2026-02-14T03:00:12Z",
  "summary": {
    "items_evaluated": 342,
    "items_matched": 28,
    "actions": { "keep": 5, "unmonitor": 8, "delete": 15 },
    "rules_skipped_missing_data": 47,
    "services_unavailable": []
  },
  "results": [
    {
      "title": "Bad Movie (2024)",
      "type": "movie",
      "tmdb_id": 12345,
      "matched_rules": ["Delete fully watched old movies"],
      "resolved_action": "delete",
      "dry_run": true
    }
  ]
}
```

**Cron scheduling:**
- Register cron expression from `config.schedule` using `@nestjs/schedule`'s `CronExpression` or dynamic scheduling
- Cron triggers the same evaluation flow as POST /evaluate

**Structured logging (Pino):**
- `info`: Evaluation started, evaluation completed (with summary)
- `warn`: Service unavailable, rule skipped for item (aggregated: "Rule X skipped for N items due to missing Jellyfin data")
- `error`: Unexpected API errors, config issues

**Health endpoint:**
- `GET /health` → `200 { status: "ok", version: "0.1.0" }`
- Returns 200 as long as the NestJS app is running

**Timezone handling:**
- Cron uses the system timezone (set via `TZ` env var in Docker)
- All date comparisons use UTC (API dates are UTC, `older_than`/`newer_than` compute against `new Date()` which is UTC-aware)

**Acceptance criteria (Phase 5):**
- [ ] POST /evaluate returns 202 with run ID
- [ ] GET /evaluate/:runId returns results when complete, 202 when running, 404 when unknown
- [ ] Concurrent evaluation attempts rejected (409 for POST, skip for cron)
- [ ] Cron schedule fires at configured time
- [ ] Structured JSON logs for evaluation summary
- [ ] Skip warnings aggregated per-rule (not per-item) to avoid log spam
- [ ] GET /health returns 200
- [ ] End-to-end test with mocked services

---

#### Phase 6: Docker + Deployment

**Goal:** Dockerfile, Docker Compose example, production-ready container.

**Files to create:**

```
Dockerfile
docker-compose.yml            # Example compose file
.dockerignore
roombarr.example.yml          # Example config for users to copy
```

**Dockerfile (multi-stage, LSIO-style conventions):**

```dockerfile
FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV CONFIG_PATH=/config/roombarr.yml
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/main.js"]
```

**Note:** Full LSIO s6-overlay + PUID/PGID support is a future improvement. v1 uses Bun's Alpine image directly, which is simpler and sufficient for personal use.

**Acceptance criteria (Phase 6):**
- [ ] Docker image builds successfully
- [ ] Container starts and loads config from /config/roombarr.yml
- [ ] Health check passes
- [ ] Example config file documents all options
- [ ] Docker Compose example works alongside typical *arr stack

---

## Dependencies & Prerequisites

**New npm packages to install:**

| Package | Purpose | Phase |
|---------|---------|-------|
| `zod` | Config schema validation | 1 |
| `yaml` | YAML parsing | 1 |
| `@nestjs/axios` | HTTP client for API calls | 2 |
| `axios` | Peer dependency of @nestjs/axios | 2 |
| `@nestjs/schedule` | Cron scheduling | 5 |
| `nestjs-pino` | Structured logging | 5 |
| `pino-http` | Peer dependency of nestjs-pino | 5 |
| `p-limit` | Bounded concurrency for API calls | 3 |

**Existing scaffold to modify:**
- `src/app.module.ts` — import all new modules
- `src/main.ts` — configure Pino logger, load config path
- Remove `src/app.controller.ts`, `src/app.service.ts` (scaffold placeholder)

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Jellyfin season aggregation is slow | Medium — evaluation takes minutes | Bounded concurrency + lazy fetching. Acceptable for nightly cron. |
| External API changes break data mapping | High — silent field mismatches | Integration tests with recorded fixtures. Validate field existence. |
| Null date edge cases cause unexpected behavior | High — items wrongly flagged | Explicit null semantics (infinitely old). Comprehensive operator tests. |
| User writes keep rule referencing optional service data | Medium — protection fails silently | Startup warning for keep rules using enrichment fields. v2 grace period solves fully. |
| Large libraries cause memory pressure | Low — home libraries are small | In-memory is fine for <10,000 items. Monitor and optimize if needed. |

## Future Considerations (v2+)

- **Live execution:** Grace period with SQLite tracking. Items flagged → wait N days → execute if still matching.
- **Notifications:** Discord webhook for flagged items. API endpoint for pending actions.
- **Aggregate operators:** "All seasons except the latest", relative comparisons.
- **Ratings conditions:** Verify Radarr/Sonarr ratings API structure against real instances.
- **Hot config reload:** SIGHUP or file watcher to reload config without restart.
- **Plex/Emby support:** Additional media server modules.
- **Web dashboard:** Visual rule builder and evaluation results browser.

## Verification Plan

### Unit Tests (Phase 1)
```bash
bun test src/config/
bun test src/rules/
```
- All operators with normal, edge, and null inputs
- Nested condition trees (AND of ORs, OR of ANDs, 3+ levels)
- Conflict resolution with all action combinations
- Config validation with valid and every type of invalid config
- Duration parsing with all units

### Integration Tests (Phases 2-4)
```bash
bun test src/sonarr/
bun test src/radarr/
bun test src/jellyfin/
bun test src/jellyseerr/
bun test src/media/
```
- API clients with recorded response fixtures
- Data mapping from real API shapes to unified models
- Cross-service merging with matched and unmatched items
- Tag resolution with existing and missing tags

### E2E Test (Phase 5)
```bash
bun test src/test/
```
- Full evaluation run with mocked services
- POST /evaluate → GET /evaluate/:runId flow
- Concurrent evaluation rejection
- Cron trigger (manual invocation in test)

### Manual Verification
- Load example config, start app, verify startup validation
- Trigger POST /evaluate, verify structured log output
- Check GET /health returns 200

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md`
- NestJS scaffold: `src/app.module.ts`
- Biome config: `biome.json` (no `any`, no default exports, named exports only)
- Bun test setup: `bunfig.toml`, `src/test/setup.ts`
- TypeScript config: `tsconfig.json` (ES2023 target, strict null checks, nodenext modules)

### External API References
- Sonarr v3 API: `GET /api/v3/series`, `GET /api/v3/tag`, `GET /api/v3/episodefile`
- Radarr v3 API: `GET /api/v3/movie`, `GET /api/v3/tag`, `DELETE /api/v3/movie/{id}`
- Jellyfin API: `GET /Users`, `GET /Users/{id}/Items`, `ProviderIds` object
- Jellyseerr API: `GET /api/v1/request` (paginated with `skip`/`take`)

### Ecosystem Conventions
- YAML config: snake_case keys (Recyclarr convention)
- Docker: LSIO-style (/config mount, PUID/PGID, Alpine base)
- Rule engine: AND/OR condition trees (json-rules-engine, Kyverno pattern)
