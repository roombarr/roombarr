---
title: "feat: Add comprehensive README documentation"
type: feat
status: completed
date: 2026-02-17
---

# feat: Add Comprehensive README Documentation

## Overview

Create a single, comprehensive `README.md` that serves as the complete user-facing documentation for Roombarr. The project currently has zero user-facing docs — only internal design documents and an example config file. This is the #1 adoption blocker for an open source utility.

## Problem Statement / Motivation

A user evaluating Roombarr has no entry point. There is no README, no usage guide, and no documentation of the rule engine, available fields, operators, or API. The `roombarr.example.yml` is the closest thing to docs, and while well-commented, it doesn't explain the runtime behaviors, edge cases, or failure modes that users will encounter.

The *arr community expects documentation similar to tools like Recyclarr, Unpackerr, and Overseerr — a README that covers installation, configuration, and usage with real examples.

## Proposed Solution

A single `README.md` with 11 sections (the 10 from the brainstorm + a Troubleshooting section identified by SpecFlow analysis). Conversational but concise tone. Heavy on YAML examples. Targets self-hosters already running the *arr stack.

## Content Specification

### Section 1: Title + One-Liner

- Project name and a single sentence describing what Roombarr does
- Example: "Roombarr is a rule-based media cleanup engine for Sonarr, Radarr, Jellyfin, and Jellyseerr."

### Section 2: Dry-Run Callout

- Prominent blockquote or admonition near the top
- Frame positively: v1 evaluates rules and shows what *would* happen — no media is deleted or unmonitored
- Mention that live execution is planned for a future release
- Position this as a feature: "safe to experiment with your rules before committing to actions"

### Section 3: Features Overview

Bullet list covering:
- Declarative YAML rules with AND/OR condition trees
- Cross-service data: combine Radarr/Sonarr metadata with Jellyfin watch history and Jellyseerr requests
- Temporal state tracking (how long something has been off an import list)
- Conflict resolution (least destructive action wins)
- Lazy data fetching (only queries services referenced by active rules)
- Cron scheduling + on-demand API trigger
- Audit logging (daily-rotated JSONL)
- Docker-first deployment

### Section 4: Quick Start

~5 steps with Docker Compose:
1. Create a `config/` directory and place `roombarr.yml` inside it (be explicit about directory structure)
2. Copy from `roombarr.example.yml` or show a minimal config inline (Radarr-only, one simple rule)
3. Create `docker-compose.yml` (show the full file from the repo)
4. `docker compose up -d`
5. **Verification step**: `curl http://localhost:3000/health` — expect `{ "status": "ok", "version": "0.1.0" }`
6. **Failure step**: If the container exits, run `docker compose logs roombarr` to see the config validation error

### Section 5: Configuration Reference

Cover each top-level key of `roombarr.yml`:

**`services`**
- `sonarr` and `radarr`: `base_url` (valid URL) + `api_key` (non-empty string). Optional individually but at least one required.
- `jellyfin` and `jellyseerr`: Same shape. Optional. Only needed if rules reference their fields.
- Note: Roombarr validates at startup that any service referenced by a rule condition is configured.

**`schedule`**
- Standard 5-field cron expression (minute hour day month weekday)
- Supports wildcards, step values (`*/5`), ranges (`1-5`), lists (`1,15,30`)
- **Important**: Schedule evaluates in the timezone set by the `TZ` environment variable. If `TZ` is unset, defaults to UTC.

**`performance`**
- `concurrency`: Max concurrent API requests. Integer, range 1–50, default 10.

**`audit`**
- `log_directory`: Path for JSONL audit logs. Default `/data/logs/`. Must be within the `DATA_PATH` directory.
- `retention_days`: How long to keep log files. Integer, range 1–3650, default 90.

**`rules`**
- Brief mention here that rules are covered in depth in the next section. Show the basic shape only.

### Section 6: Writing Rules (largest section)

This is the core of the README. Structure it as:

**6a. Rule Structure**
- Show the anatomy of a rule: `name`, `target`, `action`, `conditions`
- Explain each field briefly

**6b. Targets**
- `radarr` — each movie is evaluated independently
- `sonarr` — **each season** is evaluated independently, not the series as a whole. This is fundamental and must be stated prominently before any Sonarr examples. Explain that results will show "Breaking Bad — Season 3" not "Breaking Bad", and that deleting a season removes that season's files, not the entire series.

**6c. Actions**
- `delete` — removes from Radarr/Sonarr (and files from disk)
- `unmonitor` — stops monitoring for new downloads
- `keep` — explicitly protects an item from other rules

**6d. Conditions**
- Top-level `conditions` must be a group with `operator: AND | OR` and `children`
- Children can be leaf conditions (`field`, `operator`, `value`) or nested groups
- Show a simple AND example, then a nested OR-within-AND example
- Explain nesting clearly — users need to see the `operator` key at each group level

**6e. Operators**

Table with columns: Operator | Compatible Types | Value Type | Description

| Operator | Compatible Types | Value | Description |
|---|---|---|---|
| `equals` | string, number, boolean | Same as field | Strict equality |
| `not_equals` | string, number, boolean | Same as field | Strict inequality |
| `greater_than` | number | number | Numeric comparison |
| `less_than` | number | number | Numeric comparison |
| `older_than` | date | Duration string | True if date is older than duration ago. **Null dates always match.** |
| `newer_than` | date | Duration string | True if date is within duration. **Null dates never match.** |
| `includes` | array | string | Array contains the value |
| `not_includes` | array | string | Array does not contain the value |
| `includes_all` | array | **string array** | Array contains all listed values |
| `is_empty` | array | **none** | Array has zero elements. Do not include a `value` key. |
| `is_not_empty` | array | **none** | Array has one or more elements. Do not include a `value` key. |

**Duration format**: `<number><unit>` — valid units: `d` (days), `w` (weeks), `m` (months), `y` (years). Examples: `30d`, `6m`, `1y`. Case-sensitive.

**6f. Conflict Resolution**
- When multiple rules match the same item, the least destructive action wins
- Priority: `keep` > `unmonitor` > `delete`
- Only relevant when a single item matches multiple rules
- Show a concrete example: a movie matched by both "delete old watched movies" and "keep favorites" → result is `keep`

**6g. When Rules Are Skipped**

This subsection is critical — it addresses the #1 source of user confusion:

- If a rule references a Jellyfin or Jellyseerr field, but that service's data is absent for a specific item (e.g., a movie never played in Jellyfin), the entire rule is **skipped** for that item. It does not error — it simply does not match.
- If an enrichment service (Jellyfin/Jellyseerr) is unreachable during evaluation, all items will have null data for that service. Rules referencing those fields are skipped across the board. The run still completes — check container logs if you see unexpectedly low match counts.
- The API response includes `rules_skipped_missing_data` in the summary — this count tells you how many item-rule pairs were skipped due to missing data.
- Rules only evaluate items that currently exist in Radarr/Sonarr. Previously deleted items will not appear.

**6h. Rule Examples (3-4 realistic examples)**

Example 1: **Delete old, watched movies** (Radarr + Jellyfin)
- Delete movies added over 6 months ago where all users have watched them

Example 2: **Unmonitor ended, watched seasons** (Sonarr + Jellyfin)
- Unmonitor seasons of ended series where all episodes are downloaded and watched

Example 3: **Keep favorites** (Radarr, tag-based)
- Keep anything tagged "favorite" regardless of other rules (demonstrates conflict resolution)

Example 4: **Delete movies no longer on import lists** (Radarr + State)
- Delete movies that left all import lists more than 30 days ago
- Include a callout: state fields require at least two evaluation runs to populate. On the first run, `state.*` fields return null and rules using them will not match.

### Section 7: Available Fields

Tables organized by service. Each table has columns: Field | Type | Description | Notes

Include a "Notes" column for fields with non-obvious behavior:
- `radarr.digital_release` / `radarr.physical_release`: Can be null. Null dates always match `older_than`, never match `newer_than`.
- `jellyfin.*` fields: Absent when the item has never been played in Jellyfin.
- `state.*` fields: Null on the first evaluation run. Radarr targets only.

Tables:
- Radarr Fields (12 fields)
- Sonarr Fields (9 fields — series-level + season-level)
- Jellyfin Fields (4 fields)
- Jellyseerr Fields (3 fields)
- State Fields (2 fields — note Radarr-only limitation)

### Section 8: API

Document all three endpoints with full request/response examples:

**`GET /health`**
```
200 OK
{ "status": "ok", "version": "0.1.0" }
```

**`POST /evaluate`**
- Triggers an async evaluation. Returns immediately.
- `202 Accepted`: `{ "run_id": "uuid", "status": "running" }`
- `409 Conflict`: `{ "statusCode": 409, "message": "An evaluation is already running" }` — returned if a scheduled or manual run is already in progress

**`GET /evaluate/:runId`**
- Poll for results
- `202 Accepted` (still running): `{ "run_id": "...", "status": "running", "started_at": "..." }` — no results yet
- `200 OK` (completed): Full response with `summary` and `results`. Show the complete shape.
- `404 Not Found`: Unknown run ID (or run was evicted)
- Note: Only the last 10 runs are kept in memory. Older runs are evicted and will return 404.
- Note: The `results` array only contains items where `resolved_action` is non-null. Items that matched no rules are excluded. Use `summary.items_evaluated` for the total count.

### Section 9: Environment Variables

Table with columns: Variable | Default | Description

| Variable | Default | Description |
|---|---|---|
| `CONFIG_PATH` | `/config/roombarr.yml` | Path to the YAML config file. Fallback chain: env var → `/config/roombarr.yml` → `./roombarr.yml` |
| `DATA_PATH` | `/data` | Root directory for SQLite database and audit logs |
| `PORT` | `3000` | HTTP server listen port |
| `TZ` | UTC | Timezone for cron schedule evaluation (e.g., `America/New_York`) |
| `NODE_ENV` | `production` | Controls log format. `development` enables pretty-printed logs. |

### Section 10: Troubleshooting

Short section (5-6 bullets) covering the most common issues:

- **Container exits immediately on startup**: Config validation failed. Run `docker compose logs roombarr` to see the error. Common causes: missing required service for a rule target, invalid YAML syntax, unknown field paths, incompatible operator for field type.
- **Rules match nothing**: Check `rules_skipped_missing_data` in the evaluation summary. If enrichment services (Jellyfin/Jellyseerr) are unreachable, all rules referencing their fields are silently skipped. Check container logs for connection errors.
- **State fields don't match on first run**: Expected behavior. State fields (`state.*`) require at least two evaluation runs to populate. On the first run they return null.
- **409 when triggering manual evaluation**: A scheduled or previous manual run is still in progress. Wait for it to complete.
- **Old run ID returns 404**: Only the last 10 runs are kept in memory. Older runs are evicted.
- **Schedule fires at the wrong time**: The cron expression evaluates in the timezone set by `TZ`. If unset, defaults to UTC.

### Section 11: Development

Brief section for contributors:
- Prerequisites: Bun
- `bun install` — install dependencies
- `bun run dev` — development server with hot reload
- `bun test` — run tests
- `bun run lint` — lint with Biome
- `bun run typecheck` — type check without emitting
- Note that the project uses NestJS and TypeScript

## Acceptance Criteria

- [x] `README.md` exists at project root
- [x] All 11 sections are present and complete
- [x] All 30 condition fields are documented with correct types
- [x] All 11 operators are documented with compatible types and value requirements
- [x] Duration format is explicitly documented with all 4 valid units
- [x] At least 3 realistic rule examples are included
- [x] Docker Compose quick start includes verification and failure steps
- [x] "When Rules Are Skipped" subsection explains silent skipping behavior
- [x] State field warming caveat is prominently documented
- [x] Sonarr per-season semantics are explained before any Sonarr examples
- [x] Conflict resolution is explained with a concrete example
- [x] All 3 API endpoints have full request/response examples with status codes
- [x] Environment variables table includes all 5 variables with defaults
- [x] Config value ranges are documented (concurrency 1-50, retention_days 1-3650)
- [x] Troubleshooting section covers the 6 most common issues
- [x] Tone is conversational but concise throughout

## Source Files

### Primary References (read for accurate content)

- `src/config/field-registry.ts` — All condition fields and their types
- `src/config/config.schema.ts` — Zod schema with all validation rules and defaults
- `src/rules/operators.ts` — Operator implementations and type compatibility
- `src/evaluation/evaluation.controller.ts` — API endpoint definitions and response shapes
- `src/evaluation/evaluation.service.ts` — Run lifecycle and conflict resolution
- `src/health/health.controller.ts` — Health endpoint
- `src/audit/audit.service.ts` — Audit log format and rotation
- `src/config/config.service.ts` — Config file resolution order
- `src/shared/duration.ts` — Duration string parsing
- `src/main.ts` — Port and bootstrap config
- `roombarr.example.yml` — Example config (reference for structure)
- `docker-compose.yml` — Docker setup
- `Dockerfile` — Build stages, healthcheck, user setup

### Context Documents

- `docs/brainstorms/2026-02-17-readme-documentation-brainstorm.md` — Approved brainstorm with all design decisions
- `docs/brainstorms/2026-02-13-rule-based-media-cleanup-brainstorm.md` — Authoritative design spec for the rule engine

## References

- [Recyclarr README](https://github.com/recyclarr/recyclarr) — Example of *arr ecosystem documentation style
- [Unpackerr README](https://github.com/Unpackerr/unpackerr) — Example of utilitarian *arr tool docs
