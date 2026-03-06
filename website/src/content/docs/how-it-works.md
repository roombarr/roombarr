---
title: How It Works
description: The evaluation lifecycle — what happens when Roombarr runs, from trigger to results.
---

This page walks through what happens when Roombarr evaluates your rules — from the initial trigger through conflict resolution to the final results. Understanding this flow helps you debug unexpected behavior and write more effective rules.

## 1. Trigger

An evaluation starts in one of two ways:

- **Scheduled** — The cron expression in your [`schedule`](/roombarr/configuration/overview/#schedule) fires. The schedule evaluates in the timezone set by the `TZ` [environment variable](/roombarr/reference/environment-variables/) (defaults to UTC).
- **Manual** — You send a `POST /evaluate` request to the [API](/roombarr/reference/api/#post-evaluate).

Only one evaluation can run at a time. If a run is already in progress, scheduled triggers are skipped and manual triggers return `409 Conflict`.

## 2. Config resolution

Roombarr loads your configuration from the path set by `CONFIG_PATH` (default: `/config/roombarr.yml`). The config was already validated at startup — if the container is running, the config is valid. No re-validation happens at evaluation time.

## 3. Service queries

Roombarr uses **lazy data fetching** — it only queries services that your rules actually reference.

For example, if none of your rules use `jellyfin.*` fields, Jellyfin is never contacted during the evaluation, even if it's configured under `services`. This means:

- Adding a service to `services` doesn't add overhead unless rules reference its fields
- If an enrichment service goes down, only rules that use its fields are affected
- The [`performance.concurrency`](/roombarr/configuration/overview/#performance) setting controls how many API requests run in parallel

Roombarr always queries the target services (Radarr and/or Sonarr) for every evaluation, since that's where the items come from. Enrichment services (Jellyfin, Jellyseerr) are only queried if at least one rule references their fields.

## 4. Item enumeration

The target service determines what Roombarr iterates over:

| Target | Items | Example |
|---|---|---|
| `radarr` | Each movie is one item | "The Matrix (1999)" |
| `sonarr` | Each **season** is one item | "Breaking Bad — Season 3" |

This is an important distinction for Sonarr. A series with 5 seasons produces 5 separate evaluation items. Actions like `delete` apply to a single season's files — not the entire series. Season 0 (specials) is always excluded.

## 5. Enrichment

For each item, Roombarr attaches additional data from configured enrichment services:

- **[Jellyfin](/roombarr/integrations/jellyfin/)** — Watch history, play counts, and last played timestamps. Movies are matched by provider ID. For seasons, "watched" means a user watched every episode in that season.
- **[Jellyseerr](/roombarr/integrations/jellyseerr/)** — Request metadata including who requested it, when, and the current request status. Matched at the series/movie level.

If an enrichment service is **unreachable** during a run, all items will have null data for that service's fields. Rules referencing those fields are skipped across the board for that run, but the evaluation still completes successfully.

If an enrichment service is reachable but has **no data for a specific item** (e.g., a movie that was never played in Jellyfin), that item will have null enrichment data, and rules referencing those fields are skipped for that item only.

## 6. Rule evaluation

Each rule's [condition tree](/roombarr/configuration/rules/#conditions) is evaluated against each item independently. The condition tree is a recursive structure of AND/OR groups and leaf conditions.

For a condition group:
- **AND** — All children must match
- **OR** — At least one child must match

For a leaf condition:
- The field's value is retrieved from the item's data
- The [operator](/roombarr/reference/operators/) compares it against the rule's value
- The result is `true` (match) or `false` (no match)

### When rules are skipped

A rule is skipped for an item when the enrichment data it needs is missing. This is a safety mechanism — Roombarr won't act on incomplete information.

The `rules_skipped_missing_data` counter in the evaluation summary tracks how many rule-item pairs were skipped. If this number is unexpectedly high, check that your enrichment services are reachable. See [Rules > When rules are skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for full details.

:::note
State fields (`state.*`) are exempt from skipping. A null state value means "no history yet" — it's meaningful data, not missing data. Rules using only state fields will evaluate normally on first run (the conditions just won't match because the values are null).
:::

## 7. Conflict resolution

After all rules are evaluated, each item may have been matched by zero, one, or multiple rules — each with potentially different actions. Items that match **zero rules** are left completely untouched — no action is taken and they don't appear in the results array.

When multiple rules match, Roombarr uses a **least-destructive-wins** strategy (`keep` > `unmonitor` > `delete`). This lets you write broad cleanup rules and add targeted `keep` rules to protect specific items. See [Actions > Conflict Resolution](/roombarr/configuration/actions/#conflict-resolution) for the full priority chain, examples, and audit log details.

## 8. Action execution

What happens next depends on the `dry_run` setting:

| `dry_run` | Behavior |
|---|---|
| `true` (default) | Actions are logged but **not executed**. No API calls are made to Radarr or Sonarr. Every item's `execution_status` is `"skipped"`. |
| `false` | Roombarr calls the Radarr/Sonarr API to perform each resolved action. Items with `keep` are always skipped (it's a no-op by design). |

In live mode, each action execution can result in:

| Status | Meaning |
|---|---|
| `success` | Action completed successfully |
| `failed` | API call failed — check `execution_error` for details |
| `not_found` | Service returned 404 — the item was already gone (treated as success) |

See [Configuration Overview > dry_run](/roombarr/configuration/overview/#dry_run) for more on switching between modes.

## 9. Audit logging

Every action decision is written to daily-rotated JSONL files stored in the `/config` volume. Each entry includes:

- The item that was evaluated
- Which rules matched
- The resolved action
- Whether `dry_run` was `true` or `false`
- The execution status (in live mode)

The [`audit.retention_days`](/roombarr/configuration/overview/#audit) setting controls how long log files are kept before cleanup. This gives you a persistent record of every decision Roombarr has made, even after run results are evicted from memory.

## 10. Results

The evaluation results are available via the [API](/roombarr/reference/api/#get-evaluaterunid) using the run ID:

```bash
curl http://localhost:3000/evaluate/<run-id>
```

The response includes:

- **Summary** — Total items evaluated, how many matched, action counts, and skip counts
- **Results** — Per-item detail with matched rules, resolved actions, and execution status

Only the last **10 evaluation runs** are kept in memory. Older runs return `404 Not Found`. For persistent history, use the audit logs.

## Putting it all together

Here's the complete flow in sequence:

1. **Trigger** — Cron fires or `POST /evaluate` is called
2. **Config** — Already validated at startup, loaded from disk
3. **Fetch** — Query Radarr/Sonarr for items; query Jellyfin/Jellyseerr only if rules need them
4. **Enumerate** — Movies are individual items; TV seasons are individual items
5. **Enrich** — Attach watch history and request data to each item
6. **Evaluate** — Run each rule's condition tree against each item
7. **Resolve** — When multiple rules match, least-destructive-wins
8. **Execute** — Call APIs if `dry_run: false`; skip if `true`
9. **Log** — Write every decision to the audit log
10. **Return** — Results available via `GET /evaluate/:runId`

## Related pages

- [Configuration Overview](/roombarr/configuration/overview/) — Top-level config structure
- [Rules](/roombarr/configuration/rules/) — Condition trees and rule syntax
- [Actions](/roombarr/configuration/actions/) — Action types and conflict resolution
- [Fields](/roombarr/reference/fields/) — Every field available for conditions
- [API](/roombarr/reference/api/) — HTTP endpoints for triggering and polling evaluations
- [Config Recipes](/roombarr/recipes/) — Complete working configs for common scenarios
