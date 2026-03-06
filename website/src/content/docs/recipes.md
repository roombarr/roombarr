---
title: Config Recipes
description: Complete, copy-paste-ready roombarr.yml configurations for common scenarios.
---

Each recipe below is a **complete `roombarr.yml`** — not a fragment. Copy one as your starting point and adjust the service URLs, API keys, and rule values to match your setup.

All recipes default to `dry_run: true`. Review your evaluation results before setting `dry_run: false`.

## Radarr-only cleanup

The simplest possible setup. Delete old movies that are no longer monitored — no enrichment services required.

**What happens:** Every day at 3 AM, Roombarr checks every movie in Radarr. Movies that were added over a year ago and are no longer monitored get deleted along with their files.

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

schedule: "0 3 * * *"

rules:
  - name: Delete old unmonitored movies
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: radarr.added
          operator: older_than
          value: 1y
        - field: radarr.monitored
          operator: equals
          value: false
```

## Watch-based cleanup with Jellyfin

Delete fully watched old movies and unmonitor watched completed seasons. This is the most common multi-service setup for users who track watch history in Jellyfin.

**What happens:** Movies that everyone has watched and were added over 6 months ago get deleted. Seasons of ended TV series that everyone has watched get unmonitored (files stay, but Sonarr stops looking for new downloads).

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  sonarr:
    base_url: http://sonarr:8989
    api_key: your-sonarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

schedule: "0 3 * * *"

rules:
  # Movies: delete if everyone watched and it's been around a while
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

  # TV: stop monitoring watched seasons of ended series
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
```

## Request lifecycle management

Use Jellyseerr to clean up stale requests that nobody watched. Great for shared servers where users request media that never gets consumed.

**What happens:** Movies that were requested through Jellyseerr over a year ago and have never been played by anyone get deleted. This keeps your library focused on content people actually watch.

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

  jellyseerr:
    base_url: http://jellyseerr:5055
    api_key: your-jellyseerr-api-key

schedule: "0 3 * * *"

rules:
  - name: Delete stale unwatched requests
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: jellyseerr.requested_at
          operator: older_than
          value: 1y
        - field: jellyfin.play_count
          operator: equals
          value: 0
```

## Import list lifecycle

Delete movies that fell off all import lists after a grace period. Useful when you use import lists (e.g., Trakt, IMDb, Letterboxd) to control what belongs in your library — when a movie falls off the list, it should eventually be cleaned up.

**What happens:** Roombarr tracks whether each movie was ever on an import list and how long it's been since it left. Movies that were once on a list but have been off for more than 30 days get deleted.

:::note
State fields (`state.*`) require at least two evaluation runs to produce values. On the first run, `state.ever_on_import_list` is `false` (no history yet) and `state.days_off_import_list` is `null` (cannot be computed without history). Neither condition in this rule will match on the first run — `ever_on_import_list` won't equal `true`, and `days_off_import_list` can't be compared numerically when null. This is expected. After two runs, the fields populate and the rule starts working.
:::

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

schedule: "0 3 * * *"

rules:
  - name: Delete movies removed from import lists
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: state.ever_on_import_list
          operator: equals
          value: true
        - field: state.days_off_import_list
          operator: greater_than
          value: 30
```

## Disk space management

Target large files first when cleaning up. Useful when disk space is the primary concern and you want to reclaim the most space with the fewest deletions.

**What happens:** Movies over 50 GB that nobody has watched and were added over 3 months ago get deleted. The `size_on_disk` field is in bytes, so 50 GB = 53,687,091,200 bytes.

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

schedule: "0 3 * * *"

rules:
  - name: Delete large unwatched movies
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: radarr.size_on_disk
          operator: greater_than
          value: 53687091200  # 50 GB in bytes
        - field: jellyfin.play_count
          operator: equals
          value: 0
        - field: radarr.added
          operator: older_than
          value: 3m
```

## Protection-first approach

Start with broad cleanup rules, then add `keep` rules to protect specific items. This demonstrates [conflict resolution](/roombarr/configuration/actions/#conflict-resolution) in practice — `keep` always wins over `delete` and `unmonitor`, regardless of rule order.

**What happens:** The broad rule would delete any movie added over 6 months ago that nobody has watched. But the three `keep` rules carve out exceptions: movies tagged "favorite", movies currently on an import list, and anything in the Horror genre are all protected. Even if a horror movie matches the delete rule, the keep rule wins.

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

schedule: "0 3 * * *"

rules:
  # Broad cleanup rule
  - name: Delete old unwatched movies
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: radarr.added
          operator: older_than
          value: 6m
        - field: jellyfin.play_count
          operator: equals
          value: 0

  # Protection rules — these always win over delete
  - name: Keep favorites
    target: radarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: radarr.tags
          operator: includes
          value: favorite

  - name: Keep import list movies
    target: radarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: radarr.on_import_list
          operator: equals
          value: true

  - name: Keep horror movies
    target: radarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: radarr.genres
          operator: includes
          value: Horror
```

## Full kitchen-sink config

A comprehensive setup using all four services with multiple rules covering several scenarios. This is not a recommendation — it's a reference showing how everything fits together. Pick the rules that make sense for your library.

**What happens:** Roombarr runs daily at 3 AM with a concurrency limit of 5. It evaluates movies against four rules and seasons against two rules, then resolves conflicts using least-destructive-wins. The `keep` rules protect tagged items from all other rules.

```yaml
# ── Mode ─────────────────────────────────────────────────────
# Start with dry_run: true, review a few evaluation runs,
# then flip to false when you're confident.
dry_run: true

# ── Services ─────────────────────────────────────────────────
services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

  sonarr:
    base_url: http://sonarr:8989
    api_key: your-sonarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key

  jellyseerr:
    base_url: http://jellyseerr:5055
    api_key: your-jellyseerr-api-key

# ── Schedule ─────────────────────────────────────────────────
# Daily at 3 AM. Uses the TZ environment variable for timezone.
schedule: "0 3 * * *"

# ── Performance ──────────────────────────────────────────────
performance:
  concurrency: 5

# ── Audit ────────────────────────────────────────────────────
audit:
  retention_days: 90

# ── Rules ────────────────────────────────────────────────────
# Conflict resolution: keep > unmonitor > delete
# Rule order in this file does not matter.

rules:
  # ── Movie rules ──────────────────────────────────────────

  # Delete movies everyone has watched that have been around a while
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

  # Delete stale Jellyseerr requests nobody watched
  - name: Delete stale unwatched requests
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: jellyseerr.requested_at
          operator: older_than
          value: 1y
        - field: jellyfin.play_count
          operator: equals
          value: 0

  # Delete movies that fell off all import lists 30+ days ago
  - name: Delete movies removed from import lists
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: state.ever_on_import_list
          operator: equals
          value: true
        - field: state.days_off_import_list
          operator: greater_than
          value: 30

  # Protect anything tagged "keep" from all other rules
  - name: Protect tagged movies
    target: radarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: radarr.tags
          operator: includes
          value: keep

  # ── TV rules ─────────────────────────────────────────────

  # Unmonitor watched seasons of ended series
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

  # Protect anything tagged "keep" from all other rules
  - name: Protect tagged series
    target: sonarr
    action: keep
    conditions:
      operator: AND
      children:
        - field: sonarr.tags
          operator: includes
          value: keep
```

## Next steps

- [Configuration Overview](/roombarr/configuration/overview/) — Understand every top-level config key
- [Rules](/roombarr/configuration/rules/) — Full rule syntax and condition trees
- [Fields](/roombarr/reference/fields/) — Every field available for conditions
- [How It Works](/roombarr/how-it-works/) — What happens when Roombarr evaluates your rules
