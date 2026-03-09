---
title: "feat: Enable live action execution (delete/unmonitor)"
type: feat
status: completed
date: 2026-03-04
origin: docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md
---

# feat: Enable live action execution (delete/unmonitor)

## Overview

Roombarr v1 is permanently hardcoded to dry-run mode — it evaluates rules, logs what _would_ happen, but never calls Radarr/Sonarr mutation APIs. This feature adds the missing "execute" step to the evaluation pipeline and exposes a `dry_run` config option (default: `true`) so users can preview destructive actions before committing.

The brainstorm established this as an intentional phased rollout: _"Live execution will be added once the rule engine is trusted"_ (see brainstorm: `docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md`). The rule engine has been stable — time to let it do damage.

## Problem Statement / Motivation

Without live execution, Roombarr is an expensive logger. Users can see what _would_ happen but must manually delete/unmonitor items in Radarr/Sonarr. This defeats the purpose of an automated cleanup engine. The entire value proposition depends on this feature shipping.

## Proposed Solution

Add a top-level `dry_run` config option and an `ActionExecutorService` that sits between evaluation and response in the pipeline. When `dry_run: false`, the executor calls Radarr/Sonarr APIs to perform the resolved actions. When `dry_run: true` (default), behavior is identical to v1.

**Updated pipeline:** hydrate → snapshot → enrich → evaluate → **execute** → respond

## Technical Considerations

### 1. Internal ID Resolution (Critical Prerequisite)

Every Radarr/Sonarr mutation API requires internal IDs (`RadarrMovie.id`, `SonarrSeries.id`), but the unified models currently only carry external IDs (`tmdb_id`, `tvdb_id`). The mappers in `radarr.service.ts` and `sonarr.service.ts` discard these during `.map()`.

**Approach:** Add internal IDs directly to the unified models:

- `UnifiedMovie` gains `radarr_id: number`
- `UnifiedSeason` gains `sonarr_series_id: number`

This is the lowest-friction path. The alternative (reverse-lookup map) adds complexity for no real benefit — the internal IDs aren't sensitive and belong on the model.

**Files affected:**

- `src/shared/types.ts` — add `radarr_id` to `UnifiedMovie`, `sonarr_series_id` to `UnifiedSeason`
- `src/radarr/radarr.mapper.ts` — preserve `id` during mapping
- `src/sonarr/sonarr.mapper.ts` — preserve `id` during mapping
- `src/radarr/radarr.service.ts` — pass `id` through
- `src/sonarr/sonarr.service.ts` — pass `id` through
- `src/database/schema.ts` — if snapshots need the internal IDs (evaluate during implementation)
- Test factories (`makeMovie()`, `makeSeason()`) — add default internal IDs

### 2. Sonarr Episode File Fetching

Deleting a season's files requires episode file IDs, which the current `SonarrClient` doesn't fetch. Sonarr exposes `GET /api/v3/episodefile?seriesId={id}` returning all episode files for a series.

**Approach:** Fetch lazily during execution (not during hydration). Only seasons with `resolved_action: 'delete'` need episode file IDs. This avoids adding latency to dry-run evaluations.

**Files affected:**

- `src/sonarr/sonarr.client.ts` — add `fetchEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]>`
- `src/sonarr/sonarr.client.ts` — add `deleteEpisodeFile(episodeFileId: number): Promise<void>`
- `src/sonarr/sonarr.types.ts` — add `SonarrEpisodeFile` interface

### 3. Radarr/Sonarr Mutation API Endpoints

| Action              | Service | HTTP Method | Endpoint                              | Notes                                                                    |
| ------------------- | ------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Delete movie        | Radarr  | `DELETE`    | `/api/v3/movie/{id}?deleteFiles=true` | Irreversible. Removes movie + files from disk.                           |
| Unmonitor movie     | Radarr  | `PUT`       | `/api/v3/movie/{id}`                  | Must send full movie body with `monitored: false`. Reversible.           |
| Delete season files | Sonarr  | `DELETE`    | `/api/v3/episodefile/{id}`            | Per episode file. Irreversible.                                          |
| Unmonitor season    | Sonarr  | `PUT`       | `/api/v3/series/{id}`                 | Must send full series body with season's `monitored: false`. Reversible. |

**Unmonitor PUT body strategy:** Re-fetch the resource by internal ID at execution time, flip the `monitored` field, PUT the full object back. This adds one extra GET per unmonitor action but guarantees no metadata corruption from partial bodies.

**Files affected:**

- `src/radarr/radarr.client.ts` — add `deleteMovie(id, deleteFiles)`, `fetchMovie(id)`, `updateMovie(id, body)`
- `src/sonarr/sonarr.client.ts` — add `fetchSeries(id)`, `updateSeries(id, body)`, `fetchEpisodeFiles(seriesId)`, `deleteEpisodeFile(id)`

### 4. Config Schema

Add `dry_run` as a top-level boolean, defaulting to `true`.

```yaml
# roombarr.yml
dry_run: true # Set to false to enable live execution

services:
  # ...
schedule: "0 3 * * *"
rules:
  # ...
```

**Files affected:**

- `src/config/config.schema.ts` — add `dry_run` to `configSchema` (`.default(true)`) and `RoombarrConfig` interface
- `src/config/config.service.ts` — no changes needed (config is already fully typed)

### 5. ActionExecutorService Design

A new NestJS injectable service in the `evaluation` module (or a new `execution` module — evaluate during implementation).

```
ActionExecutorService
├── execute(results: EvaluationItemResult[], items: UnifiedMedia[], dryRun: boolean)
│   │   → Promise<{ results: EvaluationItemResult[]; executionSummary?: ExecutionSummary }>
│   ├── if dryRun → mark every result with execution_status: 'skipped' (no API calls)
│   ├── build itemsByInternalId map from items using buildInternalId()
│   ├── for each result (sequential, concurrency=1 for safety in v1):
│   │   ├── skip non-actionable items (resolved_action null or 'keep') → execution_status: 'skipped'
│   │   ├── look up hydrated item by internal_id (composite string, e.g. 'movie:42')
│   │   ├── call executeAction(item, resolved_action)
│   │   ├── record success/failure per item
│   │   └── 404 responses are logged as warnings (item already removed externally)
│   └── return results with execution status + executionSummary counts
├── executeAction(item: UnifiedMedia, action: Action): Promise<void>
├── deleteMovie(movie: UnifiedMovie): Promise<void>
├── unmonitorMovie(movie: UnifiedMovie): Promise<void>
├── deleteSeasonFiles(season: UnifiedSeason): Promise<void>
└── unmonitorSeason(season: UnifiedSeason): Promise<void>
```

**Key design decisions:**

- **Sequential execution** (no parallelism) for v1. Mutations are dangerous; sequential makes debugging and audit trails predictable.
- **Continue on failure.** If item 4 of 10 fails, items 5-10 still execute. Per-item status tracking reports what happened.
- **404 = warning only.** If Radarr/Sonarr returns 404, it is logged as a warning (item already removed externally) but not counted as a successful execution. Per-file 404s during season file deletion are handled individually — the remaining files still execute.
- **Audit after execution.** Move audit logging from `RulesService.evaluate()` to after execution completes. In dry-run mode, audit still logs during evaluation (preserving v1 behavior). In live mode, audit logs after each action attempt with the execution outcome.

**Files to create:**

- `src/execution/action-executor.service.ts`
- `src/execution/action-executor.service.test.ts`
- `src/execution/execution.module.ts`
- `src/execution/execution.types.ts`

### 6. Type System Changes

**`EvaluationItemResult.dry_run`**: Change from literal `true` to `boolean`. Add execution tracking fields.

```typescript
export interface EvaluationItemResult {
  title: string;
  type: "movie" | "season";
  external_id: number;
  matched_rules: string[];
  resolved_action: Action | null;
  dry_run: boolean;
  /** Composite key unique per item (e.g. "movie:42", "season:10:1"). */
  internal_id: string;
  /** Set during execution. Present when dry_run is true ('skipped') or when an action was attempted in live mode. */
  execution_status?: "success" | "failed" | "skipped";
  /** Error message if execution_status is 'failed'. */
  execution_error?: string;
}
```

**`EvaluationSummary`**: Add execution counts.

```typescript
export interface EvaluationSummary {
  items_evaluated: number;
  items_matched: number;
  actions: Record<Action, number>;
  rules_skipped_missing_data: number;
  /** Present only when dry_run is false. */
  actions_executed?: Record<Action, number>;
  actions_failed?: number;
}
```

**Ripple locations:**

- `src/rules/types.ts:14` — `dry_run: true` → `dry_run: boolean`
- `src/rules/rules.service.ts:85` — `dryRun: true` → `dryRun: config.dry_run`
- `src/rules/rules.service.ts:97` — `dry_run: true` → `dry_run: config.dry_run`
- `src/evaluation/evaluation.controller.ts:69` — `dry_run: true` → `dry_run: config.dry_run`
- `src/evaluation/evaluation.service.ts` — wire executor into `executeEvaluation()`
- `src/rules/rules.service.test.ts` — update assertions from `dry_run: true` to parameterized

### 7. Startup Banner

When `dry_run: false`, emit a prominent startup log:

```
⚠️  LIVE MODE ENABLED — actions will be executed against Radarr/Sonarr
```

When `dry_run: true` (default):

```
ℹ️  DRY RUN MODE — no actions will be executed
```

This goes in `main.ts` or `EvaluationModule.onModuleInit()`.

## Acceptance Criteria

### Functional Requirements

- [x]New top-level `dry_run` config option (boolean, default: `true`)
- [x]`dry_run: true` — behavior identical to v1 (evaluate + log, no mutations)
- [x]`dry_run: false` — execute resolved actions against Radarr/Sonarr APIs after evaluation
- [x]**Radarr delete:** calls `DELETE /api/v3/movie/{id}?deleteFiles=true`
- [x]**Radarr unmonitor:** re-fetches movie, sets `monitored: false`, PUTs full body
- [x]**Sonarr season delete:** fetches episode files for season, deletes each via `DELETE /api/v3/episodefile/{id}`
- [x]**Sonarr season unmonitor:** re-fetches series, sets season `monitored: false`, PUTs full body
- [x]`keep` actions are never executed (they are protective, no mutation needed)
- [x]Per-item execution status tracked (`success`, `failed`, `skipped`)
- [x]Partial failures do not abort remaining items — continue and report
- [x]404 from Radarr/Sonarr during delete logged as warning (item already removed); not counted as success or failure
- [x]Audit log entries include execution outcome when in live mode
- [x]Startup banner indicates whether system is in dry-run or live mode
- [x]Evaluation API response includes `dry_run: boolean` reflecting actual mode
- [x]Evaluation summary includes `actions_executed` and `actions_failed` counts in live mode
- [x]Internal IDs (`radarr_id`, `sonarr_series_id`) available on unified models

### Testing Requirements

- [x]Unit tests for `ActionExecutorService` — mock Radarr/Sonarr clients, verify correct API calls per action type
- [x]Unit tests for dry-run pass-through (executor is a no-op)
- [x]Unit tests for partial failure handling (continue after error)
- [x]Unit tests for 404-as-success behavior
- [x]Unit tests for unmonitor flow (re-fetch → modify → PUT)
- [x]Unit tests for Sonarr season delete (fetch episode files → filter by season → delete each)
- [x]Updated tests in `rules.service.test.ts` for parameterized `dry_run`
- [x]Config schema validation tests for `dry_run` field

## Success Metrics

- Evaluation runs with `dry_run: false` successfully delete/unmonitor items in Radarr/Sonarr
- Audit logs accurately reflect what was executed vs. what was decided
- Zero unintended mutations when `dry_run: true` (regression safety)
- All existing tests continue to pass with updated types

## Dependencies & Risks

### Dependencies

- Radarr API v3 must support `DELETE /api/v3/movie/{id}?deleteFiles=true`
- Sonarr API v3 must support `GET /api/v3/episodefile?seriesId={id}` and `DELETE /api/v3/episodefile/{id}`
- Both APIs must accept `PUT` with full resource body for unmonitor operations

### Risks

| Risk                                         | Likelihood | Impact   | Mitigation                                                    |
| -------------------------------------------- | ---------- | -------- | ------------------------------------------------------------- |
| Misconfigured rule deletes entire library    | Medium     | Critical | `dry_run: true` default. Users must explicitly opt in.        |
| Radarr/Sonarr API changes in future versions | Low        | Medium   | Client methods are thin wrappers; easy to update.             |
| Partial execution leaves inconsistent state  | Medium     | Medium   | Per-item tracking + continue-on-failure + audit logging.      |
| Unmonitor PUT corrupts metadata              | Low        | High     | Re-fetch full resource before PUT; never send partial bodies. |

### Future Considerations (Not in Scope)

- **Blast-radius limit** (`max_actions_per_run`) — prevent catastrophic misconfiguration
- **Per-rule `dry_run` override** — some rules live, others preview-only
- **Execution concurrency** — parallel mutations for large libraries
- **Confirmation period** — run dry once, execute on next matching run
- **Notification integrations** — Discord/webhook alerts on live execution

## MVP

### `src/config/config.schema.ts` — Add dry_run to schema

```typescript
export const configSchema = z.object({
  dry_run: z.boolean().default(true),
  services: servicesSchema,
  schedule: z.string().min(1),
  performance: performanceSchema,
  audit: auditSchema,
  rules: z.array(ruleSchema).min(1),
});
```

### `src/shared/types.ts` — Add internal IDs to unified models

```typescript
export interface UnifiedMovie {
  type: "movie";
  radarr_id: number; // Internal Radarr movie ID for API mutations
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  year: number;
  radarr: RadarrData;
  jellyfin: JellyfinData | null;
  jellyseerr: JellyseerrData | null;
  state: StateData | null;
}

export interface UnifiedSeason {
  type: "season";
  sonarr_series_id: number; // Internal Sonarr series ID for API mutations
  tvdb_id: number;
  title: string;
  year: number;
  sonarr: SonarrData;
  jellyfin: JellyfinData | null;
  jellyseerr: JellyseerrData | null;
  state: StateData | null;
}
```

### `src/radarr/radarr.client.ts` — Add mutation methods

```typescript
async deleteMovie(movieId: number, deleteFiles = true): Promise<void> {
  this.logger.debug(`Deleting movie ${movieId} (deleteFiles: ${deleteFiles})`);
  await firstValueFrom(
    this.http.delete(`/api/v3/movie/${movieId}`, {
      params: { deleteFiles },
    }),
  );
}

async fetchMovie(movieId: number): Promise<RadarrMovie> {
  const { data } = await firstValueFrom(
    this.http.get<RadarrMovie>(`/api/v3/movie/${movieId}`),
  );
  return data;
}

async updateMovie(movieId: number, body: RadarrMovie): Promise<void> {
  await firstValueFrom(
    this.http.put(`/api/v3/movie/${movieId}`, body),
  );
}
```

### `src/sonarr/sonarr.client.ts` — Add mutation methods

```typescript
async fetchEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
  const { data } = await firstValueFrom(
    this.http.get<SonarrEpisodeFile[]>('/api/v3/episodefile', {
      params: { seriesId },
    }),
  );
  return data;
}

async deleteEpisodeFile(episodeFileId: number): Promise<void> {
  await firstValueFrom(
    this.http.delete(`/api/v3/episodefile/${episodeFileId}`),
  );
}

async fetchSeriesById(seriesId: number): Promise<SonarrSeries> {
  const { data } = await firstValueFrom(
    this.http.get<SonarrSeries>(`/api/v3/series/${seriesId}`),
  );
  return data;
}

async updateSeries(seriesId: number, body: SonarrSeries): Promise<void> {
  await firstValueFrom(
    this.http.put(`/api/v3/series/${seriesId}`, body),
  );
}
```

### `src/execution/action-executor.service.ts` — Core executor

```typescript
@Injectable()
export class ActionExecutorService {
  private readonly logger = new Logger(ActionExecutorService.name);

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly sonarrClient: SonarrClient,
  ) {}

  /**
   * Execute resolved actions against Radarr/Sonarr.
   * In dry-run mode, every result is marked as 'skipped' with no API calls.
   * In live mode, each actionable item is executed sequentially.
   */
  async execute(
    results: EvaluationItemResult[],
    items: UnifiedMedia[],
    dryRun: boolean,
  ): Promise<{
    results: EvaluationItemResult[];
    executionSummary?: ExecutionSummary;
  }> {
    if (dryRun)
      return {
        results: results.map((r) => ({
          ...r,
          execution_status: "skipped" as const,
        })),
      };

    const itemsByInternalId = new Map(
      items.map((item) => [buildInternalId(item), item]),
    );

    const executed: EvaluationItemResult[] = [];
    const counts: Record<Action, number> = { keep: 0, unmonitor: 0, delete: 0 };
    let failedCount = 0;

    for (const result of results) {
      if (!result.resolved_action || result.resolved_action === "keep") {
        executed.push({ ...result, execution_status: "skipped" });
        continue;
      }

      const item = itemsByInternalId.get(result.internal_id);
      if (!item) {
        executed.push({
          ...result,
          execution_status: "failed",
          execution_error: "Item not found in hydrated data",
        });
        failedCount++;
        continue;
      }

      try {
        await this.executeAction(item, result.resolved_action);
        executed.push({ ...result, execution_status: "success" });
        counts[result.resolved_action]++;
      } catch (error) {
        if (this.isNotFound(error)) {
          this.logger.warn(
            `${result.resolved_action} "${result.title}": 404 — already removed`,
          );
        } else {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          this.logger.error(
            `Failed to ${result.resolved_action} "${result.title}": ${message}`,
          );
          executed.push({
            ...result,
            execution_status: "failed",
            execution_error: message,
          });
          failedCount++;
        }
      }
    }

    return {
      results: executed,
      executionSummary: {
        actions_executed: counts,
        actions_failed: failedCount,
      },
    };
  }
}
```

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md](docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md) — Key decisions carried forward: dry-run as v1 default, actions are `delete`/`unmonitor`/`keep`, least-destructive-wins conflict resolution.

### Internal References

- Evaluation pipeline: `src/evaluation/evaluation.service.ts:117` (`executeEvaluation`)
- Hardcoded dry-run: `src/rules/rules.service.ts:85` and `:97`
- Literal type constraint: `src/rules/types.ts:14`
- Controller hardcoded response: `src/evaluation/evaluation.controller.ts:69`
- Audit service (already supports `dry_run: boolean`): `src/audit/audit.service.ts:53`
- Radarr client (read-only): `src/radarr/radarr.client.ts`
- Sonarr client (read-only): `src/sonarr/sonarr.client.ts`
- Config schema: `src/config/config.schema.ts:134`
- Unified model types: `src/shared/types.ts`

### External References

- Radarr API v3 docs: https://radarr.video/docs/api/
- Sonarr API v3 docs: https://sonarr.tv/docs/api/
- Audit logging plan: `docs/plans/2026-02-15-feat-audit-logging-destructive-actions-plan.md`
- Persistence migration solution: `docs/solutions/database-issues/raw-sqlite-to-drizzle-orm-migration.md`

### Related Work

- Audit logging (completed): supports `dry_run: boolean` discriminator in entries
- Drizzle persistence layer (completed): snapshot schema may need internal ID columns
