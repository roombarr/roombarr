---
title: Config Recipes
description: Complete, copy-paste-ready roombarr.yml configurations for common scenarios.
---

Each recipe below is a **complete `roombarr.yml`** — not a fragment. Copy one as your starting point and adjust the service URLs, API keys, and rule values to match your setup.

All recipes default to `dry_run: true`. Review your evaluation results before setting `dry_run: false`.

:::tip
These recipes use Radarr, but the same patterns work for Sonarr — change the `target` to `sonarr` and use `sonarr.*` fields instead of `radarr.*`. See the [Reference](/roombarr/reference/) page for available Sonarr fields.
:::

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
          value: 6mo

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

## Protection-first approach

Start with broad cleanup rules, then add `keep` rules to protect specific items. This demonstrates conflict resolution in practice — `keep` always wins over `delete` and `unmonitor`, regardless of rule order.

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
          value: 6mo
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
