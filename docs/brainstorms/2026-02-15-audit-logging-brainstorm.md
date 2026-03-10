# Audit Logging for Destructive Actions

**Date:** 2026-02-15
**Status:** Brainstorm

## What We're Building

A dedicated audit trail that records every destructive action Roombarr takes (delete, unmonitor) along with the reasoning behind each decision. The audit log serves three purposes:

1. **Reviewable history** — a persistent, browsable record of what the app did and why
2. **Safety net** — durable on-disk logs that survive Docker log rotation
3. **External tooling** — structured format that can feed into log aggregators (Loki, etc.)

### Scope

Audit logging covers **destructive actions only** — not the full evaluation pipeline. Specifically:

- When media is deleted, unmonitored, or explicitly kept (override)
- Which rule matched and why (condition tree evaluation result)
- What media data drove the decision (key fields at time of evaluation)

Operational logging (fetches, enrichment, health checks) stays on the existing Pino stdout path.

## Why This Approach

**Approach chosen: Dedicated AuditModule + AuditService**

A thin `AuditModule` provides a typed `AuditService` with a structured API for recording actions. Under the hood, it writes JSONL via a Pino file transport. Console output continues through the existing Pino stdout logger.

### Why not Pino multi-transport alone?

Pino multi-transport (Approach 1) is simpler but loses the typed contract. Audit events are too important to be freeform log calls — a dedicated service enforces structure at the call site and makes it easy to test that the right data was recorded.

### Why not a database table?

SQLite audit tables (Approach 3) are queryable but heavier than needed. JSONL files meet all stated goals (reviewable, durable, tooling-compatible) without mixing operational data with audit data in one database. JSONL is also natively `grep`/`jq`-friendly.

## Key Decisions

| Decision         | Choice                               | Rationale                                                                            |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Scope            | Destructive actions only             | Keep audit log focused and meaningful                                                |
| Format           | JSONL (one JSON object per line)     | Machine-parseable, grep-friendly, jq-compatible, works with log aggregators          |
| File strategy    | Daily rotation                       | Natural time boundaries, easy to prune, won't grow unbounded                         |
| Storage location | `/data/logs/` (configurable)         | Same Docker volume as SQLite; path configurable in roombarr.yml for bare-metal users |
| Retention        | Auto-prune, 90-day default           | Prevent unbounded disk growth; configurable in roombarr.yml                          |
| Console output   | Continues via existing Pino stdout   | Audit events also logged to console at info level                                    |
| Architecture     | Dedicated AuditModule + AuditService | Typed API, testable, separation of concerns                                          |

## Audit Log Entry Shape

Each JSONL line would contain:

- **timestamp** — ISO 8601
- **action** — `delete` | `unmonitor` | `keep`
- **media_type** — `movie` | `season`
- **media** — identifying snapshot: title, year, and service IDs (radarr_id/sonarr_id, jellyfin_id, jellyseerr_id) present at time of evaluation
- **rule** — name of the rule that produced this action
- **reasoning** — human-readable string describing the matched condition (e.g., `"rating < 5.0 AND age_days > 180"`)
- **dry_run** — boolean (critical for distinguishing real vs. simulated actions)
- **evaluation_id** — ties back to the evaluation run

**Note on `keep` actions:** Only logged when `keep` overrides a rule that would have otherwise deleted or unmonitored. Silent keeps (no competing rule) are not audit events.

## Resolved Questions

1. **Default retention period** — 90 days. Gives home media server users enough runway to spot patterns or investigate late-noticed issues.
2. **Log directory configurability** — Configurable in `roombarr.yml`. Defaults to `/data/logs/` (Docker) or `./data/logs/` (bare-metal).
3. **Pino file transport library** — `pino-roll` is the leading candidate for daily-rotated file output. Actively maintained, 142K weekly downloads. Bun transport compatibility should be validated during implementation (known issues exist with `pino-pretty` transport resolution, though the app already uses it in dev successfully).
