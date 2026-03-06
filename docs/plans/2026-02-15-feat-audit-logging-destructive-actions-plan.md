---
title: "feat: Add Audit Logging for Destructive Actions"
type: feat
status: completed
date: 2026-02-15
deepened: 2026-02-15
---

> **Note:** `state.days_off_import_list` was replaced by `state.import_list_removed_at` in PR #25. References below reflect the original design.

# feat: Add Audit Logging for Destructive Actions

## Enhancement Summary

**Deepened on:** 2026-02-15
**Review agents used:** TypeScript Reviewer, Pattern Recognition Specialist, Performance Oracle, Security Sentinel, Code Simplicity Reviewer, Architecture Strategist
**Additional research:** Context7 (pino-roll docs, NestJS lifecycle docs)

### Key Improvements

1. **Eliminated custom pruning** — pino-roll's built-in `limit.count` handles file retention natively during rotation, removing ~40 LOC of custom readdir/unlink logic
2. **Improved type safety** — discriminated union for `AuditEntry` ensures correct media IDs per type (movies get `tmdb_id`, seasons get `tvdb_id`)
3. **Security hardening** — path traversal validation on `log_directory`, explicit file permissions (0o750 dir, 0o640 files)
4. **Performance optimization** — memoize reasoning strings per rule before evaluation loop (~93% reduction in string operations)
5. **Graceful shutdown** — flush with timeout prevents both data loss and indefinite hangs

### New Considerations Discovered

- pino-roll supports `mkdir: true`, simplifying directory creation
- Reuse existing `Action` type from `config.schema.ts` instead of redeclaring
- Architecture Strategist confirmed zero circular dependency risk with @Global AuditModule
- RulesService is the correct emission point (data locality, Information Expert principle)

---

## Overview

Add a dedicated audit trail that records every destructive action Roombarr takes (delete, unmonitor) and keep-overrides, along with the reasoning behind each decision. Audit events are written to daily-rotated JSONL files in a configurable directory and simultaneously logged to console via the existing Pino logger.

**Brainstorm:** `docs/brainstorms/2026-02-15-audit-logging-brainstorm.md`

## Problem Statement / Motivation

Roombarr performs destructive actions on users' media libraries — deleting files and unmonitoring content in Sonarr/Radarr. Today (v1) these actions are dry-run only, but when real execution ships, users need a durable, reviewable record of what was done and why. Docker logs are ephemeral and hard to search. A structured audit trail on disk provides:

1. A persistent history for "why did my movie get deleted?"
2. A safety net surviving Docker log rotation
3. A structured format compatible with external log aggregators (Loki, Promtail, etc.)

## Proposed Solution

A new `AuditModule` with a global `AuditService` that provides a typed API for recording audit events. Under the hood, it creates a dedicated Pino logger instance with a `pino-roll` file transport for daily-rotated JSONL output. The existing stdout logger continues unchanged for operational logs.

### Architecture

```
EvaluationService / RulesService
        │
        ▼
  AuditService (Global)
        │
        ├──▶ Pino file transport (pino-roll) ──▶ /data/logs/audit.YYYY-MM-DD.N.jsonl
        │
        └──▶ NestJS Logger (existing Pino stdout) ──▶ console
```

### Research Insights: Architecture

**Architecture Strategist Validation:**
- @Global() is architecturally correct — audit logging is infrastructure, same classification as ConfigModule and DatabaseModule
- Dedicated Pino instance is superior to multi-transport — operational and audit logs have different lifecycles, rotation needs, and retention requirements
- Zero circular dependency risk — AuditService is a pure sink (writes only, no business logic dependencies)
- All SOLID principles pass: SRP (audit only), OCP (no modification to existing infrastructure), ISP (single `logAction()` method), DIP (RulesService depends on AuditService abstraction)

**Emission Point Decision:**
Two reviewers suggested EvaluationService as the emission point. Architecture Strategist makes the stronger case for RulesService:
- **Data locality** — RulesService has all needed data at the moment of decision (matched_rules, resolved_action, condition tree, media item)
- **Information Expert** — RulesService is the expert on "why this action"
- **Separation of concerns** — EvaluationService is an orchestrator; it shouldn't know audit implementation details
- Moving to EvaluationService would require either duplicating reasoning logic or passing rule configs through the return interface

### Audit Event Schema

```typescript
import type { Action } from '../config/config.schema.js';

interface BaseAuditEntry {
  timestamp: string;          // ISO 8601
  evaluation_id: string;      // UUID from EvaluationRun
  action: Action;             // Reuse existing type
  rule: string;               // Name of the winning rule
  matched_rules: string[];    // All rules that matched (shows conflict resolution)
  reasoning: string;          // Human-readable condition string
  dry_run: boolean;
}

interface MovieAuditEntry extends BaseAuditEntry {
  media_type: 'movie';
  media: {
    title: string;
    year: number;
    tmdb_id: number;          // Required for movies
  };
}

interface SeasonAuditEntry extends BaseAuditEntry {
  media_type: 'season';
  media: {
    title: string;
    year: number;
    tvdb_id: number;          // Required for seasons
  };
}

export type AuditEntry = MovieAuditEntry | SeasonAuditEntry;
```

**Example JSONL line:**
```json
{"timestamp":"2026-02-15T10:30:00.000Z","evaluation_id":"a1b2c3","action":"delete","media_type":"movie","media":{"title":"Bad Film","year":2020,"tmdb_id":12345},"rule":"low-rating-old","matched_rules":["low-rating-old"],"reasoning":"radarr.monitored = true AND jellyfin.play_count = 0 AND radarr.added older_than 180d","dry_run":true}
```

**Key schema decisions:**
- **Discriminated union** — TypeScript enforces that `media_type: 'movie'` requires `tmdb_id` and `media_type: 'season'` requires `tvdb_id`. Prevents nonsensical combinations at compile time. Mirrors existing `UnifiedMedia` pattern in `src/shared/types.ts`.
- **Reuse `Action` type** — imported from `config.schema.ts` rather than redeclaring. If actions expand (e.g., `'archive'`), audit logs get it automatically.
- **`keep` actions** — only logged when `matched_rules.length > 1` and the resolved action is `keep` (i.e., keep overrode a competing destructive rule). Silent keeps produce no audit event.
- **`matched_rules` array** — captures all competing rules for conflict resolution transparency, not just the winner.
- **No schema version field** — unnecessary complexity for v1. If the schema changes, we handle it then.

### Config Schema Addition

New optional `audit` section in `roombarr.yml`:

```yaml
# roombarr.yml
audit:
  log_directory: /data/logs/    # Default: /data/logs/ (Docker) or ./data/logs/ (bare-metal)
  retention_days: 90            # Default: 90. Min: 1.
```

Zod schema:

```typescript
// src/config/config.schema.ts
const auditSchema = z
  .object({
    log_directory: z.string().min(1).default('/data/logs/'),
    retention_days: z.number().int().min(1).default(90),
  })
  .default({});
```

The entire `audit` section is optional — all fields have defaults. Follows the existing `performanceSchema` pattern (always present with defaults).

### Research Insights: Config

**Security — Path Traversal Validation:**
The configurable `log_directory` needs runtime validation in `AuditService.onModuleInit()` to prevent path traversal attacks. While the self-hosted context reduces severity, the pruning logic could delete files outside the intended directory if given a malicious path.

```typescript
// In AuditService.onModuleInit()
const resolvedDir = path.resolve(logDir);
const dataDir = path.resolve(process.env.DATA_PATH ?? '/data');

if (!resolvedDir.startsWith(dataDir)) {
  throw new Error(
    `Audit log_directory must be within the data directory. Got: ${resolvedDir}`
  );
}
```

## Technical Considerations

### Error Handling

- **Directory creation failure on startup** → fatal error, app refuses to start. If we can't write audit logs, we shouldn't perform destructive actions. Note: pino-roll supports `mkdir: true` which handles directory creation natively.
- **Write failures during evaluation** → Pino writes are async/buffered by default. If the disk fills up, Pino drops events silently (SonicBoom behavior). The evaluation continues. This is acceptable — the alternative (aborting evaluation mid-run) risks inconsistent state. Disk-full is an infrastructure problem the user should monitor.
- **File retention** → pino-roll's built-in `limit.count` handles this during rotation. No custom pruning needed.

### Performance

- **Pino writes are async** — events are buffered and flushed in batches via SonicBoom. Zero meaningful impact on evaluation pipeline latency.
- **Reasoning string memoization** — reasoning strings are derived from the rule's condition tree, which is identical for all items matching the same rule. Pre-compute a `Map<ruleName, reasoningString>` before the evaluation loop to avoid redundant tree walks. For 1000 matched items with 10 rules: 15,000 string operations → ~1,010 (~93% reduction).
- **Graceful shutdown** → `OnModuleDestroy` flushes the Pino transport with a 5-second timeout to prevent both data loss and indefinite hangs:

```typescript
async onModuleDestroy() {
  try {
    await Promise.race([
      this.flushTransport(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Flush timeout')), 5000)
      ),
    ]);
    this.logger.log('Audit log flushed successfully');
  } catch {
    this.logger.warn('Audit flush timed out — some events may be lost');
  }
}
```

### Research Insights: Performance

**Scalability Projections (Performance Oracle):**

| Scenario | Items | Matches | Events | File Size | Memory Peak |
|----------|-------|---------|--------|-----------|-------------|
| Small Library | 200 | 20 | 20 | ~5KB | ~100KB |
| Medium Library | 1000 | 150 | 150 | ~40KB | ~500KB |
| Large Library | 5000 | 800 | 800 | ~200KB | ~2MB |
| Stress Test | 10,000 | 2000 | 2000 | ~500KB | ~5MB |

**Concurrency Safety:** `EvaluationService` already prevents concurrent evaluations (line 54), so only one evaluation writes audit events at a time. No write contention possible.

### Timezone & Rotation

- `pino-roll` daily rotation uses the process timezone, which inherits from the `TZ` environment variable already set in `docker-compose.yml` (`TZ=America/New_York`).
- If an evaluation spans midnight, events are split across two files naturally. The `evaluation_id` field allows correlating events across files. This is documented behavior, not a bug.

### Reasoning String Generation

The `reasoning` field is built by walking the rule's condition tree and producing a human-readable string:

- **Single condition:** `"jellyfin.play_count = 0"`
- **AND group:** `"(radarr.monitored = true AND jellyfin.play_count = 0)"`
- **OR group:** `"(radarr.added older_than 180d OR jellyfin.watched_by_all = true)"`
- **Nested:** `"(radarr.monitored = true AND (jellyfin.play_count = 0 OR state.days_off_import_list > 90))"`

This is a pure function on the condition tree — no media data needed, just the rule definition. Reasoning strings should be **memoized per rule** before the evaluation loop since the condition tree is identical for every item evaluated against the same rule.

```typescript
// Before the item loop in RulesService.evaluate()
const reasoningCache = new Map<string, string>();
for (const rule of rules) {
  reasoningCache.set(rule.name, this.auditService.buildReasoning(rule.conditions));
}
```

### Research Insights: Reasoning

**Architecture Strategist:** Reasoning generator belongs in AuditService as a private helper. RulesService passes the condition tree; AuditService handles formatting. This follows SRP — RulesService evaluates, AuditService formats.

### Bun Compatibility

The app already uses `pino-pretty` as a Pino transport in dev mode successfully. `pino-roll` uses the same transport mechanism. Should be validated with a quick smoke test early in implementation. Fallback: write directly to a SonicBoom file stream with manual date-based filename switching.

### Research Insights: pino-roll Configuration (from Context7)

pino-roll v4.0.0 supports these options that simplify our implementation:

```typescript
const transport = pino.transport({
  target: 'pino-roll',
  options: {
    file: path.join(logDir, 'audit'),
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd',
    extension: '.jsonl',
    mkdir: true,              // Auto-creates directory — no manual mkdirSync needed
    limit: {
      count: retentionDays,   // Built-in file retention — no custom pruning needed!
    },
    symlink: true,            // Creates 'audit' symlink pointing to current file
  },
});
```

**Key discoveries:**
- **`limit.count`** — pino-roll deletes oldest files during rotation when count exceeds limit. This completely eliminates the need for custom startup pruning logic (readdir + unlink).
- **`mkdir: true`** — auto-creates the log directory with `recursive: true`. Still validate the path exists post-init for the fatal startup error requirement.
- **`symlink: true`** — creates a symlink to the current log file, making `tail -f /data/logs/audit` easy for users.

### Research Insights: Security

**Security Sentinel findings (prioritized):**

| Finding | Severity | Action |
|---------|----------|--------|
| Path traversal on `log_directory` | MEDIUM | Validate resolved path starts with data directory |
| No explicit file permissions | MEDIUM | Set 0o750 on directory, rely on pino-roll defaults for files |
| Disk exhaustion DoS | MEDIUM | Document SonicBoom silent drop behavior |
| Pruning pattern safety | LOW | Eliminated — pino-roll `limit.count` handles retention |
| No encryption at rest | LOW | Document volume encryption as optional hardening step |
| SIGKILL data loss | LOW | Flush with timeout in OnModuleDestroy |

**Not implementing for v1:**
- Rate limiting on audit events (concurrency guard already prevents runaway evaluations)
- HMAC signatures on audit entries (home server threat model doesn't warrant it)
- `enabled: boolean` kill switch (removing the audit section or not importing AuditModule achieves this)

## Acceptance Criteria

- [x] New `AuditModule` registered as `@Global()` in `AppModule`
- [x] `AuditService` writes JSONL to daily-rotated files via `pino-roll`
- [x] Audit events logged to console at info level via existing NestJS Logger
- [x] `audit` config section parsed from `roombarr.yml` with Zod validation and defaults
- [x] App fails to start if log directory path is outside data directory (path traversal protection)
- [x] Log directory created via pino-roll `mkdir: true` with path validation on init
- [x] File retention handled by pino-roll `limit.count` based on `retention_days`
- [x] `keep` actions only audited when overriding a competing destructive rule
- [x] `reasoning` field contains human-readable condition string, memoized per rule
- [x] `matched_rules` includes all rules that matched, not just the winner
- [x] `AuditEntry` uses discriminated union (MovieAuditEntry | SeasonAuditEntry)
- [x] Pino transport flushed on graceful shutdown with 5-second timeout
- [x] `.gitignore` updated with `data/logs/` and `*.jsonl`
- [x] `roombarr.example.yml` updated with `audit` section
- [x] Unit tests for `AuditService` (log formatting, reasoning generation, path validation)
- [x] Unit tests for config schema validation (audit section defaults, validation)

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `pino-roll` incompatible with Bun | Low | App already uses Pino transports in Bun. Fallback to raw SonicBoom + manual rotation. Validate with smoke test before implementation. |
| Disk full loses audit events | Low | Pino/SonicBoom drops silently. Users should monitor disk. Document this behavior. |
| Reasoning string generation complexity | Low | Pure function on condition tree. Existing condition types are flat (AND/OR groups with leaf conditions). Memoized per rule. |
| Path traversal via `log_directory` | Low | Runtime validation ensures path resolves within data directory. |

## Implementation Phases

### Phase 1: Config & Module Scaffolding

**Files to modify:**
- `src/config/config.schema.ts` — add `auditSchema`, update `RoombarrConfig` interface and `configSchema`
- `roombarr.example.yml` — add `audit` section with comments

**Files to create:**
- `src/audit/audit.module.ts` — `@Global()` module exporting `AuditService`
- `src/audit/audit.service.ts` — skeleton with DI, lifecycle hooks, path validation

**File to modify:**
- `src/app.module.ts` — import `AuditModule` (place after DatabaseModule in imports array)

### Phase 2: File Transport & Types

**Files to create:**
- `src/audit/audit.types.ts` — `AuditEntry` discriminated union, `MovieAuditEntry`, `SeasonAuditEntry`

**Files to modify:**
- `src/audit/audit.service.ts` — initialize pino-roll transport in `onModuleInit` with `mkdir: true` and `limit.count`, implement `onModuleDestroy` flush with timeout

**Dependencies:**
- `pino-roll` (install via `bun add pino-roll`)
- `pino` (already installed as transitive dep of `nestjs-pino`)

### Phase 3: Audit Event API & Reasoning

**Files to modify:**
- `src/audit/audit.service.ts` — implement `logAction()` method, reasoning string builder (`buildReasoning()`)
- `src/rules/rules.service.ts` — inject `AuditService`, pre-compute reasoning cache, emit audit events after `resolveAction()`

### Phase 4: Housekeeping & Tests

**Files to modify:**
- `.gitignore` — add `data/logs/` and `*.jsonl`

**Files to create:**
- `src/audit/audit.service.test.ts` — unit tests for formatting, reasoning generation, path validation

**Files to modify:**
- `src/rules/rules.service.test.ts` — add/update tests to verify `AuditService` is called correctly

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-15-audit-logging-brainstorm.md`
- Logging config: `src/app.module.ts:17-26`
- Evaluation pipeline: `src/evaluation/evaluation.service.ts:117-166`
- Rules evaluation loop: `src/rules/rules.service.ts:32-61`
- Action resolution: `src/rules/rules.service.ts:50` (`resolveAction`)
- Action types: `src/config/config.schema.ts:31` (`Action` type)
- Action priority: `src/rules/types.ts:29-33` (`ACTION_PRIORITY`)
- Config schema: `src/config/config.schema.ts:58-70` (`RoombarrConfig`)
- Config loading: `src/config/config.service.ts:10-14`
- Global module pattern: `src/database/database.module.ts:1-9`
- Lifecycle hooks pattern: `src/database/database.service.ts:51-69`
- Unified media types: `src/shared/types.ts:55-76`
- Condition operators: `src/config/config.schema.ts:15-27`
- Field registry: `src/config/field-registry.ts`
- Existing `.gitignore`: already has `*.log`

### External References

- `pino-roll` docs: https://github.com/mcollina/pino-roll (v4.0.0, 142K weekly downloads)
- Pino transports: https://getpino.io/#/docs/transports
- Bun + pino-pretty issue: https://github.com/oven-sh/bun/issues/23062

### Review Agent Findings

- **TypeScript Reviewer:** Use discriminated union for AuditEntry, reuse Action type, consider EvaluationService emission point
- **Pattern Recognition:** A- grade, all patterns match codebase, confirmed EvaluationService preference (overridden by Architecture Strategist)
- **Performance Oracle:** Memoize reasoning strings (93% improvement), add size-based rotation, flush timeout, move pruning to background
- **Security Sentinel:** Path traversal (P0), file permissions (P0), disk exhaustion docs (P1), YAML bomb protection (P1)
- **Code Simplicity:** Challenged module-level abstraction for v1 dry-run scope. Valid YAGNI concern, but user deliberately chose AuditModule during brainstorming for typed API and testability.
- **Architecture Strategist:** Confirmed @Global correct, RulesService correct emission point, reasoning belongs in AuditService, zero circular dependency risk, all SOLID principles pass
