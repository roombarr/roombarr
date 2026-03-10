---
title: Configuration
description: Config file structure, services, rules, actions, and validation.
---

Roombarr is configured through a single YAML file at `/config/roombarr.yml`. It validates the entire config at startup and refuses to start if anything is invalid.

## Config file shape

```yaml
dry_run: true
services: { ... }
schedule: "0 3 * * *"
performance: { ... }
audit: { ... }
rules: [...]
```

## dry_run

Defaults to `true`, making Roombarr safe to deploy out of the box. When `true`, Roombarr evaluates every rule and logs what it _would_ do, but never calls Radarr or Sonarr APIs to perform actions. Set to `false` only after reviewing your evaluation results.

```yaml
dry_run: false
```

## Services

The `services` block tells Roombarr how to connect to your \*arr stack. Each service needs a `base_url` and an `api_key`.

**Required:** At least one of `radarr` or `sonarr`.

**Optional:** `jellyfin` and `jellyseerr` are enrichment services — only needed if your rules reference their fields.

```yaml
services:
  radarr:
    base_url: http://radarr:7878 # Settings → General → API Key
    api_key: your-radarr-api-key

  sonarr:
    base_url: http://sonarr:8989
    api_key: your-sonarr-api-key

  jellyfin:
    base_url: http://jellyfin:8096 # Dashboard → API Keys
    api_key: your-jellyfin-api-key

  jellyseerr:
    base_url: http://jellyseerr:5055 # Settings → General → API Key
    api_key: your-jellyseerr-api-key
```

If Roombarr and your services are on the same Docker network, use Docker service names as the URL (e.g., `http://radarr:7878`). No trailing slash.

If a rule references a field from an unconfigured service, Roombarr will refuse to start and tell you exactly which service is missing.

## Schedule

**Required.** Standard 5-field cron expression (minute hour day month weekday). Evaluates in the timezone set by the `TZ` environment variable (defaults to UTC).

```yaml
schedule: "0 3 * * *" # Daily at 3:00 AM
```

You can also trigger evaluations manually via the [HTTP API](/roombarr/api/).

## Performance

**Optional.** Controls the maximum number of concurrent API requests to external services.

```yaml
performance:
  concurrency: 10 # 1–50, default: 10
```

## Audit

**Optional.** Every action decision is logged to daily-rotated JSONL files in the `/config` volume.

```yaml
audit:
  retention_days: 90 # 1–3650, default: 90
```

## Rules

Rules are the core of Roombarr. Each rule targets either `radarr` or `sonarr`, defines conditions using a composable AND/OR tree, and specifies an action.

### Anatomy of a rule

```yaml
rules:
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
```

- **`name`** — Human-readable label for logs and audit trail.
- **`target`** — `radarr` (evaluates per-movie) or `sonarr` (evaluates per-season).
- **`action`** — `delete`, `unmonitor`, or `keep`. See [Actions](#actions) below.
- **`conditions`** — An AND/OR condition tree.

### Targets

| Target   | Evaluates                     | On delete                                     |
| -------- | ----------------------------- | --------------------------------------------- |
| `radarr` | Each movie independently      | Removes the movie and deletes files from disk |
| `sonarr` | Each **season** independently | Deletes episode files for that season only    |

### Condition groups

The top-level `conditions` is always a group with `operator` (AND/OR) and `children`.

```yaml
# All children must match
conditions:
  operator: AND
  children:
    - field: radarr.monitored
      operator: equals
      value: false
    - field: radarr.added
      operator: older_than
      value: 1y
```

```yaml
# At least one child must match
conditions:
  operator: OR
  children:
    - field: jellyfin.watched_by_all
      operator: equals
      value: true
    - field: radarr.added
      operator: older_than
      value: 2y
```

### Leaf conditions

```yaml
- field: radarr.year # Dotted field path
  operator: less_than # Comparison operator
  value: 2010 # Value to compare against
```

The `is_empty` and `is_not_empty` operators must **not** include a `value`. All other operators require one.

### Nesting groups

Children can be groups or leaves — nest to arbitrary depth for complex logic like "A AND (B OR C)":

```yaml
conditions:
  operator: AND
  children:
    - field: radarr.monitored
      operator: equals
      value: false
    - operator: OR
      children:
        - field: jellyfin.watched_by_all
          operator: equals
          value: true
        - field: radarr.added
          operator: older_than
          value: 2y
```

### When rules are skipped

A rule is skipped for an item when the enrichment data it needs is missing — Roombarr won't act on incomplete information.

- **Missing item data** — If Jellyfin has no data for a specific movie, rules referencing `jellyfin.*` fields are skipped for that movie only.
- **Unreachable service** — If Jellyfin is down, all items have null Jellyfin data and every rule referencing Jellyfin fields is skipped for that run.

:::note
State fields (`state.*`) are exempt from skipping. A null state value means "no history yet" — it's meaningful data, not missing data.
:::

## Actions

| Action      | Description                                           |
| ----------- | ----------------------------------------------------- |
| `delete`    | Remove from Radarr/Sonarr and delete files from disk  |
| `unmonitor` | Stop monitoring for new downloads (files stay)        |
| `keep`      | Explicitly protect this item from other rules (no-op) |

### Conflict resolution

When multiple rules match the same item, Roombarr uses **least-destructive-wins**:

**`keep` > `unmonitor` > `delete`**

This means you can write broad cleanup rules and add targeted `keep` rules to protect specific items — the `keep` rules always win. Rule order in the config file does not matter.

## Config reload

Roombarr reads the config once at startup. To apply changes, restart the container. For example, with Docker Compose:

```bash
docker compose restart roombarr
```

Other platforms (Unraid, TrueNAS, Portainer) have their own restart mechanisms — consult your platform's docs.

## Environment variables

| Variable      | Default                | Description                                                                                                                        |
| ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PUID`        | `1000`                 | User ID for file permissions — see [Understanding PUID and PGID](https://docs.linuxserver.io/general/understanding-puid-and-pgid/) |
| `PGID`        | `1000`                 | Group ID for file permissions                                                                                                      |
| `CONFIG_PATH` | `/config/roombarr.yml` | Path to the YAML config file                                                                                                       |
| `PORT`        | `3000`                 | HTTP server listen port                                                                                                            |
| `TZ`          | _(UTC)_                | Timezone for cron schedule evaluation (e.g., `America/New_York`)                                                                   |
| `NODE_ENV`    | `production`           | Controls log format. Set to `development` for pretty-printed logs.                                                                 |

## Validation

Roombarr validates the entire config at startup. Beyond schema validation, it checks:

- At least one of `radarr` or `sonarr` is configured
- Each rule's `target` matches a configured service
- Enrichment services are configured if rules reference their fields
- Operators are compatible with the field types they're applied to
