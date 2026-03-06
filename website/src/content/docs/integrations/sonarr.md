---
title: Sonarr
description: Setup and available fields for Sonarr integration, including per-season evaluation.
---

Sonarr is one of Roombarr's two **target services** (the other being [Radarr](/roombarr/integrations/radarr/)). It provides the TV series data that rules evaluate against, and it's where Roombarr executes actions like `delete` and `unmonitor`. You need Sonarr configured if any of your rules use `target: sonarr`.

## Setup

Add a `sonarr` entry under `services` in your `roombarr.yml`:

```yaml
services:
  sonarr:
    base_url: http://sonarr:8989   # Sonarr's root URL (no trailing slash)
    api_key: your-sonarr-api-key   # Settings → General → API Key
```

- **`base_url`** — The root URL of your Sonarr instance. If Roombarr and Sonarr share a Docker network, use the Docker service name (e.g., `http://sonarr:8989`). If they're on separate networks, use the host IP or DNS name with the port Sonarr is listening on.
- **`api_key`** — Found in Sonarr under **Settings → General → Security → API Key**. Copy the full key.

:::tip
If you see connection errors in the logs, verify that Roombarr can reach Sonarr from inside the container. See [Docker > Verifying connectivity](/roombarr/deployment/docker/#verifying-connectivity) for how to test.
:::

Roombarr validates your config at startup. If any rule references a `sonarr.*` field but `services.sonarr` is missing, Roombarr will refuse to start.

## Per-season evaluation

Unlike Radarr, which evaluates each movie as a single item, Sonarr rules evaluate **per-season**. Each season of a series becomes its own evaluation item, and every rule condition is checked independently against that season.

This means a series with 5 seasons produces 5 separate evaluation items. A rule might match seasons 1–3 but not seasons 4–5, and Roombarr will only act on the matched seasons.

:::note
Season 0 (specials) is always excluded from evaluation. Specials seasons often have unusual metadata and rarely represent content you'd want to clean up automatically.
:::

Series-level fields like `sonarr.status` and `sonarr.year` are the same for every season of a series. Season-level fields like `sonarr.season.episode_count` and `sonarr.season.has_file` vary per season. You can mix both in the same rule — the series-level fields simply apply uniformly across all seasons.

## Available fields

These fields are available in rule conditions when `target` is `sonarr`. Use the `sonarr.*` prefix in the `field` key of your conditions.

| Field | Type | Description | Notes |
|---|---|---|---|
| `sonarr.status` | string | Series status (e.g., `ended`, `continuing`) | Series-level |
| `sonarr.year` | number | First air year | Series-level |
| `sonarr.path` | string | Filesystem path to the series folder | Series-level |
| `sonarr.tags` | array | Tag names applied in Sonarr | Series-level — lowercased |
| `sonarr.genres` | array | Genre strings | Series-level |
| `sonarr.season.monitored` | boolean | Whether this season is monitored | Season-level |
| `sonarr.season.season_number` | number | Season number | Season-level |
| `sonarr.season.episode_count` | number | Total episodes in the season | Season-level |
| `sonarr.season.episode_file_count` | number | Episodes with files downloaded | Season-level |
| `sonarr.season.size_on_disk` | number | Season file size in bytes | Season-level |
| `sonarr.season.has_file` | boolean | Whether the season has any episode files | Derived from `episode_file_count > 0`. Season-level |

Sonarr rules can also use enrichment fields (`jellyfin.*`, `jellyseerr.*`) when those services are configured. See [Fields](/roombarr/reference/fields/) for the complete list.

:::note
The state tracking system is generic and supports any target, but the only state fields defined today (`state.days_off_import_list`, `state.ever_on_import_list`) track Radarr-specific data. See [Fields > State](/roombarr/reference/fields/#state) for details.
:::

### Tags

Tag names are lowercased — use `keep`, not `Keep`, in your conditions. See [Fields > Service notes](/roombarr/reference/fields/#service-notes) for details.

## Compatible operators

Each field type determines which operators you can use. See [Fields > Operator compatibility](/roombarr/reference/fields/#operator-compatibility) for the full compatibility matrix and [Operators](/roombarr/reference/operators/) for operator details and duration syntax.

## Actions

All three actions operate at the **season level** — `delete` removes only that season's episode files, `unmonitor` affects only that season, and `keep` protects only that season. The series itself and other seasons are left untouched. See [Actions](/roombarr/configuration/actions/) for full details.

## Example rules

### Delete early seasons of long-running series

Free up disk space by removing early seasons when a series has many seasons and the older ones are fully downloaded.

```yaml
- name: Delete early seasons of long series
  target: sonarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: sonarr.season.season_number
        operator: less_than
        value: 3
      - field: sonarr.season.episode_file_count
        operator: greater_than
        value: 0
      - field: sonarr.status
        operator: equals
        value: continuing
```

### Unmonitor seasons with no downloaded episodes

Stop monitoring seasons that have zero episode files — they may have been manually deleted or never grabbed.

```yaml
- name: Unmonitor empty seasons
  target: sonarr
  action: unmonitor
  conditions:
    operator: AND
    children:
      - field: sonarr.season.episode_file_count
        operator: equals
        value: 0
      - field: sonarr.season.monitored
        operator: equals
        value: true
```

### Keep tagged seasons

Protect any season of a series tagged `keep` from being deleted or unmonitored by other rules. Because `keep` wins [conflict resolution](/roombarr/configuration/actions/#conflict-resolution), this overrides any `delete` or `unmonitor` rules that match the same season.

```yaml
- name: Protect tagged series seasons
  target: sonarr
  action: keep
  conditions:
    operator: AND
    children:
      - field: sonarr.tags
        operator: includes
        value: keep
```

## Related pages

- [Radarr](/roombarr/integrations/radarr/) — The other target service, for movies
- [Fields](/roombarr/reference/fields/) — Consolidated field reference across all services
- [Actions](/roombarr/configuration/actions/) — Action types and conflict resolution
- [Operators](/roombarr/reference/operators/) — Operator reference and duration syntax
