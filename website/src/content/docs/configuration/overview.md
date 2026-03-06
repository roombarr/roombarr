---
title: Configuration Overview
description: Config file structure, services block, schedule, and dry_run mode.
---

Roombarr is configured through a single YAML file. At startup, it resolves the config path in this order:

1. The path set by the `CONFIG_PATH` [environment variable](/roombarr/reference/environment-variables/)
2. `/config/roombarr.yml` (default)

If the file is missing or invalid, Roombarr refuses to start and prints a clear error message.

## Config File Shape

Every config file has the same top-level structure:

```yaml
dry_run: true
services: { ... }
schedule: "0 3 * * *"
performance: { ... }
audit: { ... }
rules: [ ... ]
```

Each section is covered below except `rules`, which has its own dedicated page — see [Rules](/roombarr/configuration/rules/).

## dry_run

Dry-run mode defaults to `true`, making Roombarr safe to deploy out of the box.

```yaml
dry_run: false # Set to false to enable live execution
```

When `true`, Roombarr evaluates every rule and logs what it *would* do, but never calls Radarr or Sonarr APIs to perform actions. When `false`, it executes the resolved actions (delete, unmonitor, or keep) against your services after each evaluation.

:::tip
Leave dry-run on until you've reviewed the [audit logs](#audit) and confirmed the rules behave as expected. Flip to `false` only when you're confident.
:::

## Services

The `services` block tells Roombarr how to connect to your *arr stack. Each service needs a `base_url` and an `api_key`.

**Required:** At least one of `sonarr` or `radarr` must be configured — otherwise there's nothing to clean up.

**Optional:** [`jellyfin`](/roombarr/integrations/jellyfin/) and [`jellyseerr`](/roombarr/integrations/jellyseerr/) are enrichment services. You only need to configure them if your rules reference their fields (e.g., `jellyfin.watched_by_all` or `jellyseerr.requested_at`).

```yaml
services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  sonarr:
    base_url: http://sonarr:8989
    api_key: your-sonarr-api-key

  # Optional — only needed if your rules use jellyfin.* fields
  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

  # Optional — only needed if your rules use jellyseerr.* fields
  jellyseerr:
    base_url: http://jellyseerr:5055
    api_key: your-jellyseerr-api-key
```

If a rule references a field from an unconfigured service (e.g., `jellyfin.watched_by_all` without `services.jellyfin`), Roombarr will refuse to start and tell you exactly which service is missing. See the integration pages for setup details: [Radarr](/roombarr/integrations/radarr/), [Sonarr](/roombarr/integrations/sonarr/), [Jellyfin](/roombarr/integrations/jellyfin/), [Jellyseerr](/roombarr/integrations/jellyseerr/).

## Schedule

The `schedule` field accepts a standard 5-field cron expression (minute hour day month weekday). It supports wildcards (`*`), step values (`*/5`), ranges (`1-5`), and lists (`1,15,30`).

```yaml
schedule: "0 3 * * *" # Daily at 3:00 AM
```

:::note
At config load, Roombarr only checks that `schedule` is a non-empty string. An invalid cron expression (e.g., `"not a cron"`) will pass config validation but fail at runtime when the scheduler tries to parse it.
:::

The schedule evaluates in the timezone set by the [`TZ` environment variable](/roombarr/reference/environment-variables/#tz). If `TZ` is not set, it defaults to UTC.

You can also trigger evaluations manually through the HTTP API without waiting for the next scheduled run. See the [API Reference](/roombarr/reference/api/) for details.

## Performance

The `performance.concurrency` setting controls the maximum number of concurrent API requests Roombarr makes to external services.

```yaml
performance:
  concurrency: 10 # 1–50, default: 10
```

Lower values reduce load on your services but slow down evaluations. Higher values speed things up for large libraries but put more pressure on your *arr stack. The default of `10` is a reasonable starting point for most setups.

## Audit

Every action decision is logged to daily-rotated JSONL files. Each entry is tagged with the `dry_run` status at evaluation time, so you can always tell whether an action was real or simulated.

```yaml
audit:
  retention_days: 90 # 1–3650, default: 90
```

The `retention_days` setting controls how long Roombarr keeps audit log files before cleaning them up. This is especially useful while you're still tuning rules in dry-run mode — review the logs to verify behavior before switching to live execution.

## Rules

Rules are the core of Roombarr. They're defined as an array under the `rules` key, and you need at least one. Each rule targets either `sonarr` or `radarr`, defines conditions using a composable AND/OR tree, and specifies an [action](/roombarr/configuration/actions/) (`delete`, `unmonitor`, or `keep`).

Rules are covered in full on the [Rules](/roombarr/configuration/rules/) page. For available actions and how conflicts are resolved, see [Actions](/roombarr/configuration/actions/).

## Full Example

Here's a complete config file you can use as a starting point. Copy it to `/config/roombarr.yml` and adjust to your setup:

```yaml
# roombarr — Rule-Based Media Cleanup Engine
# Copy this file to /config/roombarr.yml and adjust to your setup.

# ── Services ──────────────────────────────────────────────────
# At least one of sonarr or radarr must be configured.
# Jellyfin and Jellyseerr are optional enrichment services.
services:
  sonarr:
    base_url: http://sonarr:8989
    api_key: your-sonarr-api-key

  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

  jellyseerr:
    base_url: http://jellyseerr:5055
    api_key: your-jellyseerr-api-key

# ── Schedule ──────────────────────────────────────────────────
# Standard 5-field cron expression (minute hour day month weekday).
# Example: run daily at 3:00 AM.
schedule: "0 3 * * *"

# ── Performance ───────────────────────────────────────────────
# Max concurrent API requests to external services.
performance:
  concurrency: 10

# ── Audit ─────────────────────────────────────────────────────
# audit:
#   retention_days: 90           # Default: 90. Min: 1.

# ── Rules ─────────────────────────────────────────────────────
# Each rule targets either sonarr (TV seasons) or radarr (movies).
# Conditions are AND/OR trees referencing fields from any configured service.
# Actions: delete | unmonitor | keep
# Conflict resolution: keep > unmonitor > delete (least destructive wins).
#
# Tip: set dry_run: false at the top level when you're ready for live execution.

rules:
  # Delete movies that everyone has watched and were added over 6 months ago
  - name: Delete fully watched old movies
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: jellyfin.watched_by_all
          operator: equals
          value: true
        - field: radarr.added
          operator: older_than
          value: 6m

  # Unmonitor completed series seasons that everyone has watched
  - name: Unmonitor watched completed seasons
    target: sonarr
    action: unmonitor
    conditions:
      operator: AND
      children:
        - field: sonarr.status
          operator: equals
          value: ended
        - field: jellyfin.watched_by_all
          operator: equals
          value: true

  # See Rules page for more examples: /roombarr/configuration/rules/
```

## Config reload behavior

Roombarr reads the config file once at startup. Changes to `roombarr.yml` are **not** hot-reloaded — you must restart the container for config changes to take effect.

```bash
docker compose restart roombarr
```

## Validation

Roombarr validates your entire config file at startup. If anything is wrong, it prints a clear error message and refuses to start — you'll never end up running with a broken config.

Beyond basic schema validation (types, required fields, value ranges), Roombarr performs cross-validation checks:

- At least one of `services.sonarr` or `services.radarr` must be configured
- Each rule's `target` must match a configured service
- Enrichment services (`jellyfin`, `jellyseerr`) must be configured if any rule references their fields
- Operators must be compatible with the field type they're applied to

:::tip
If Roombarr won't start, check the logs for the specific error message. It will tell you exactly which field, rule, or service caused the problem. See [Troubleshooting](/roombarr/troubleshooting/) for common issues and solutions.
:::

## Related pages

- [Rules](/roombarr/configuration/rules/) — Condition trees, targets, and rule syntax
- [Actions](/roombarr/configuration/actions/) — Action types and conflict resolution
- [Environment Variables](/roombarr/reference/environment-variables/) — Docker environment variables including `TZ` and `CONFIG_PATH`
- [Getting Started](/roombarr/getting-started/) — Quick-start guide and first rule walkthrough
- [How It Works](/roombarr/how-it-works/) — The full evaluation lifecycle
