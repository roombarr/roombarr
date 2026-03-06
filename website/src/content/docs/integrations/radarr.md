---
title: Radarr
description: Setup and available fields for Radarr integration.
---

Radarr is one of Roombarr's two **target services** (the other being [Sonarr](/roombarr/integrations/sonarr/)). It provides the movie data that rules evaluate against, and it's where Roombarr executes actions like `delete` and `unmonitor`. You need Radarr configured if any of your rules use `target: radarr`.

## Setup

Add a `radarr` entry under `services` in your `roombarr.yml`:

```yaml
services:
  radarr:
    base_url: http://radarr:7878   # Radarr's root URL (no trailing slash)
    api_key: your-radarr-api-key   # Settings → General → API Key
```

- **`base_url`** — The root URL of your Radarr instance. If Roombarr and Radarr share a Docker network, use the Docker service name (e.g., `http://radarr:7878`). If they're on separate networks, use the host IP or DNS name with the port Radarr is listening on.
- **`api_key`** — Found in Radarr under **Settings → General → Security → API Key**. Copy the full key.

:::tip
If you see connection errors in the logs, verify that Roombarr can reach Radarr from inside the container. See [Docker > Verifying connectivity](/roombarr/deployment/docker/#verifying-connectivity) for how to test.
:::

## Available fields

These fields are available in rule conditions when `target` is `radarr`. Use the `radarr.*` prefix in the `field` key of your conditions.

| Field | Type | Description | Notes |
|---|---|---|---|
| `radarr.added` | date | When the movie was added to Radarr | |
| `radarr.digital_release` | date | Digital release date | Can be null — see [Null dates](#null-dates) |
| `radarr.physical_release` | date | Physical release date | Can be null — see [Null dates](#null-dates) |
| `radarr.size_on_disk` | number | File size in bytes | `0` when no file exists |
| `radarr.has_file` | boolean | Whether a file exists on disk | |
| `radarr.monitored` | boolean | Whether the movie is monitored | |
| `radarr.on_import_list` | boolean | Whether the movie is on any import list | |
| `radarr.status` | string | Release status — `tba`, `announced`, `inCinemas`, or `released` | Values come from Radarr's API |
| `radarr.year` | number | Release year | |
| `radarr.tags` | array | Tag names applied in Radarr | Lowercased — use lowercase values in conditions |
| `radarr.genres` | array | Genre strings | Values retain original casing from Radarr metadata (e.g., `Horror`, not `horror`) |
| `radarr.import_list_ids` | array | IDs of import lists containing this movie | Empty array if not on any list |

Radarr rules can also use enrichment fields (`jellyfin.*`, `jellyseerr.*`) and state fields (`state.*`) when those services are configured. See [Fields](/roombarr/reference/fields/) for the complete list.

### Null dates

The `radarr.digital_release` and `radarr.physical_release` fields can be null when Radarr doesn't have release date information for a movie. When a date field is null, `older_than` always matches (treated as infinitely old) and `newer_than` never matches. This is a safe default for cleanup rules. See [Operators > Null handling](/roombarr/reference/operators/#null-handling) for the complete behavior table.

### Tags

Tag names are lowercased — use `keep`, not `Keep`, in your conditions:

```yaml
- field: radarr.tags
  operator: includes
  value: keep       # Not "Keep" — tags are lowercased
```

## Actions

All three actions operate at the **movie level** — `delete` removes the movie and all its files from disk, `unmonitor` stops Radarr from searching for downloads, and `keep` protects the movie from other rules. See [Actions](/roombarr/configuration/actions/) for full details.

## Compatible operators

Each field type determines which operators you can use. See [Operators](/roombarr/reference/operators/) for the full compatibility matrix and duration syntax.

## Example rules

### Delete movies past their digital release window

Clean up movies whose digital release was over 6 months ago and are taking up significant disk space.

```yaml
- name: Delete old digital releases
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: radarr.digital_release
        operator: older_than
        value: 6m
      - field: radarr.size_on_disk
        operator: greater_than
        value: 10000000000   # ~10 GB
```

### Unmonitor movies without files

Stop monitoring movies that have no file on disk — they may have been manually deleted or never downloaded.

```yaml
- name: Unmonitor missing movies
  target: radarr
  action: unmonitor
  conditions:
    operator: AND
    children:
      - field: radarr.has_file
        operator: equals
        value: false
      - field: radarr.added
        operator: older_than
        value: 3m
```

### Keep movies on import lists

Protect anything that's still on an import list from being deleted by other rules. Because `keep` wins [conflict resolution](/roombarr/configuration/actions/#conflict-resolution), this overrides any `delete` rules that match the same movie.

```yaml
- name: Protect import list movies
  target: radarr
  action: keep
  conditions:
    operator: AND
    children:
      - field: radarr.on_import_list
        operator: equals
        value: true
```

### Delete horror movies not on any import list

Use genre filtering to clean up movies in a specific genre that aren't protected by an import list.

```yaml
- name: Delete old horror movies
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: radarr.genres
        operator: includes
        value: Horror
      - field: radarr.on_import_list
        operator: equals
        value: false
      - field: radarr.added
        operator: older_than
        value: 1y
```

## Related pages

- [Sonarr](/roombarr/integrations/sonarr/) — The other target service, with per-season evaluation
- [Fields](/roombarr/reference/fields/) — Consolidated field reference across all services
- [Actions](/roombarr/configuration/actions/) — Action types and conflict resolution
- [Operators](/roombarr/reference/operators/) — Operator reference and duration syntax
