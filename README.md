<h1 align="center">
  <br>
  <img src="website/src/assets/logo-transparent.png" alt="Roombarr" width="200">
  <br>
  <br>
  Roombarr
  <br>
</h1>

<h4 align="center">A rule-based media cleanup engine for the <a href="https://wiki.servarr.com">*arr stack</a>.</h4>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#writing-rules">Writing Rules</a> •
  <a href="#available-fields">Available Fields</a> •
  <a href="#api">API</a>
</p>

> **🚨 Early Development (v0.x)** — Breaking changes may occur between minor versions. Pin your Docker image to a specific version tag (e.g., `ghcr.io/roombarr/roombarr:v0.1.1`) instead of using `:latest` to avoid unexpected behavior. All breaking changes are documented in the [changelog](https://github.com/roombarr/roombarr/releases).

## Features

- **Declarative YAML rules** with composable AND/OR condition trees
- **Cross-service intelligence** — combine Radarr/Sonarr metadata with Jellyfin watch history and Jellyseerr request data in a single rule
- **Temporal state tracking** — conditions like "deleted 30 days after leaving all import lists" that look back through evaluation history
- **Conflict resolution** — when multiple rules match, the least destructive action always wins
- **Lazy data fetching** — only queries services that are actually referenced by your rules
- **Scheduled and on-demand** — cron-based automatic runs plus an HTTP API to trigger evaluations manually
- **Audit logging** — daily-rotated JSONL logs of every action decision
- **Docker-first** — designed to run alongside your existing *arr stack

## Quick Start

### 1. Create your configuration

Create a `roombarr.yml` with your service connections and rules. This file will be mounted into the container at `/config`. Here's a minimal example using Radarr only:

```yaml
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

### 2. Create a `docker-compose.yml`

```yaml
services:
  roombarr:
    image: ghcr.io/roombarr/roombarr:latest # pin to a version tag for production
    container_name: roombarr
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./config:/config
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/New_York
```

### 3. Start Roombarr

```bash
docker compose up -d
```

### 4. Verify it's running

```bash
curl http://localhost:3000/health
# → { "status": "ok", "version": "x.y.z" }
```

If the container exits immediately, check the logs for configuration errors:

```bash
docker compose logs roombarr
```

Roombarr validates your entire configuration at startup and will refuse to start if anything is invalid — you'll see a clear error message describing what needs to be fixed.

## Configuration

Roombarr is configured through a single YAML file. The config file is resolved in this order:

1. Path set by the `CONFIG_PATH` environment variable
2. `/config/roombarr.yml`

### `dry_run`

Controls whether Roombarr executes actions against Radarr/Sonarr or just logs what it would do. Defaults to `true`.

```yaml
dry_run: false  # Set to false to enable live execution
```

When `dry_run: true` (the default), evaluations run normally and log results, but no media is deleted or unmonitored. When `dry_run: false`, Roombarr will call Radarr/Sonarr APIs to perform the resolved actions after each evaluation.

### `services`

Connections to your *arr stack. At least one of `sonarr` or `radarr` must be configured.

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

Roombarr validates at startup that any service referenced by a rule condition is configured. If you write a rule using `jellyfin.watched_by_all` but don't configure `services.jellyfin`, Roombarr will refuse to start.

### `schedule`

A standard 5-field cron expression (minute hour day month weekday). Supports wildcards (`*`), step values (`*/5`), ranges (`1-5`), and lists (`1,15,30`).

```yaml
schedule: "0 3 * * *"  # Daily at 3:00 AM
```

The schedule evaluates in the timezone set by the `TZ` environment variable. If `TZ` is not set, it defaults to UTC.

### `performance`

```yaml
performance:
  concurrency: 10  # Max concurrent API requests (1–50, default: 10)
```

### `audit`

Destructive actions are logged to daily-rotated JSONL files. Each entry is tagged with `dry_run: true` or `dry_run: false` reflecting the mode at evaluation time.

```yaml
audit:
  retention_days: 90  # How long to keep log files (1–3650, default: 90)
```

### `rules`

Rules are covered in depth in the next section. At a minimum, you need at least one rule:

```yaml
rules:
  - name: Rule name
    target: radarr    # or sonarr
    action: delete    # or unmonitor or keep
    conditions:
      operator: AND
      children:
        - field: radarr.added
          operator: older_than
          value: 6mo
```

## Writing Rules

Rules are the core of Roombarr. Each rule defines a target, an action, and a set of conditions. When all conditions match a media item, the action is applied.

### Rule Structure

```yaml
- name: Delete fully watched old movies    # A descriptive name for logging
  target: radarr                            # What to evaluate against
  action: delete                            # What to do when conditions match
  conditions:                               # When to apply the action
    operator: AND
    children:
      - field: jellyfin.watched_by_all
        operator: equals
        value: true
      - field: radarr.added
        operator: older_than
        value: 6mo
```

### Targets

- **`radarr`** — Each movie is evaluated independently as its own item.
- **`sonarr`** — Each **season** is evaluated independently, not the series as a whole.

This is an important distinction for Sonarr rules. Results will show individual seasons (e.g., "Breaking Bad — Season 3"), and actions like `delete` apply to that season's files only — not the entire series.

### Actions

| Action | Description |
|---|---|
| `delete` | Remove from Radarr/Sonarr and delete files from disk |
| `unmonitor` | Stop monitoring for new downloads |
| `keep` | Explicitly protect this item from other rules |

### Conditions

The top-level `conditions` key must always be a condition group with an `operator` (`AND` or `OR`) and a `children` array. Children can be individual conditions or nested groups.

A simple AND — all conditions must match:

```yaml
conditions:
  operator: AND
  children:
    - field: radarr.added
      operator: older_than
      value: 6mo
    - field: radarr.on_import_list
      operator: equals
      value: false
```

Nested groups — combine AND and OR logic:

```yaml
conditions:
  operator: AND
  children:
    - field: radarr.added
      operator: older_than
      value: 3mo
    - operator: OR
      children:
        - field: jellyfin.watched_by_all
          operator: equals
          value: true
        - field: jellyfin.play_count
          operator: equals
          value: 0
```

This matches movies added over 3 months ago that have either been watched by everyone _or_ have never been played at all.

### Operators

| Operator | Compatible Types | Value | Description |
|---|---|---|---|
| `equals` | string, number, boolean | Same as field type | Strict equality |
| `not_equals` | string, number, boolean | Same as field type | Strict inequality |
| `greater_than` | number | number | Greater than comparison. Null fields never match. |
| `less_than` | number | number | Less than comparison. Null fields never match. |
| `older_than` | date | Duration string | True if the date is further in the past than the duration. Null dates always match. |
| `newer_than` | date | Duration string | True if the date is within the duration. Null dates never match. |
| `includes` | array | string | Array contains the value |
| `not_includes` | array | string | Array does not contain the value |
| `includes_all` | array | string[] | Array contains every value in the list |
| `is_empty` | array | _(none)_ | Array has zero elements. Do not include a `value` key. |
| `is_not_empty` | array | _(none)_ | Array has one or more elements. Do not include a `value` key. |

**Duration format:** Durations are parsed by [`parse-duration`](https://github.com/jkroso/parse-duration). Common examples: `30d` (30 days), `2w` (2 weeks), `6mo` (6 months), `1y` (1 year), `12h` (12 hours), `45m` (45 minutes), `30s` (30 seconds). Compound expressions like `1w 3d` are also supported. See the [parse-duration README](https://github.com/jkroso/parse-duration#readme) for the full syntax reference.

> **Note:** `m` means **minutes**, not months. Use `mo` for months (e.g., `6mo`). Months are treated as ~30.44 days and years as 365.25 days rather than calendar-aware subtraction.

### Conflict Resolution

When multiple rules match the same item, the least destructive action wins:

**`keep` > `unmonitor` > `delete`**

For example, if a movie matches both "Delete old watched movies" (`action: delete`) and "Keep favorites" (`action: keep`), the resolved action is `keep`. The audit log will record both matched rules so you can see the conflict.

This means you can write broad cleanup rules and then add targeted `keep` rules to protect specific items — the keep rules will always win.

### When Rules Are Skipped

Understanding when rules are skipped helps you debug unexpected results:

- **Missing enrichment data:** If a rule uses a Jellyfin or Jellyseerr field, but that service has no data for a specific item (e.g., a movie that's never been played in Jellyfin), the entire rule is skipped for that item. It doesn't error — it simply doesn't match.

- **Unreachable services:** If an enrichment service is unreachable during evaluation, all items will have null data for that service. Rules referencing those fields are skipped across the board for that run. The run still completes successfully — check the container logs if you see unexpectedly low match counts.

- **The `rules_skipped_missing_data` counter:** The evaluation summary includes this count, which tells you how many item-rule pairs were skipped due to missing service data. If this number is high, verify that your enrichment services are reachable.

- **Deleted items:** Rules only evaluate items that currently exist in Radarr/Sonarr. Items previously deleted from those services won't appear.

### Examples

**Delete old, watched movies** — Remove movies added over 6 months ago that everyone has watched:

```yaml
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

**Unmonitor ended, watched seasons** — Stop monitoring seasons of completed series that everyone has watched:

```yaml
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

**Keep favorites** — Protect anything tagged "favorite" from deletion, regardless of other rules:

```yaml
- name: Keep favorites
  target: radarr
  action: keep
  conditions:
    operator: AND
    children:
      - field: radarr.tags
        operator: includes
        value: favorite
```

Because `keep` always wins over `delete` and `unmonitor`, this rule protects any movie tagged "favorite" even if other rules would delete it.

**Delete movies no longer on import lists** — Remove movies that fell off all import lists more than 30 days ago:

```yaml
- name: Delete movies removed from import lists
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: state.ever_on_import_list
        operator: equals
        value: true
      - field: state.import_list_removed_at
        operator: older_than
        value: "30d"
```

> **Note:** State fields (`state.*`) require at least two evaluation runs to populate. On the first run, these fields return null and rules using them will not match. This is expected — Roombarr needs historical data from previous evaluations to compute how long something has been off an import list.

## Available Fields

Fields are referenced in conditions using dotted paths like `radarr.added` or `jellyfin.watched_by`. The field's type determines which operators you can use with it.

### Radarr Fields

Available on rules with `target: radarr`.

| Field | Type | Description | Notes |
|---|---|---|---|
| `radarr.added` | date | When the movie was added to Radarr | |
| `radarr.digital_release` | date | Digital release date | Can be null. Null dates always match `older_than`, never match `newer_than`. |
| `radarr.physical_release` | date | Physical release date | Can be null. Same null behavior as above. |
| `radarr.size_on_disk` | number | File size in bytes | |
| `radarr.has_file` | boolean | Whether a file exists on disk | |
| `radarr.monitored` | boolean | Whether the movie is monitored | |
| `radarr.on_import_list` | boolean | Whether the movie is on any import list | |
| `radarr.status` | string | Release status (e.g., `released`, `announced`) | |
| `radarr.year` | number | Release year | |
| `radarr.tags` | array | Tag names applied in Radarr | |
| `radarr.genres` | array | Genre strings | |
| `radarr.import_list_ids` | array | IDs of import lists containing this movie | |

### Sonarr Fields

Available on rules with `target: sonarr`. Sonarr rules evaluate per-season, so series-level fields apply to every season of that series.

| Field | Type | Description | Notes |
|---|---|---|---|
| `sonarr.status` | string | Series status (e.g., `ended`, `continuing`) | Series-level |
| `sonarr.year` | number | First air year | Series-level |
| `sonarr.tags` | array | Tag names applied in Sonarr | Series-level |
| `sonarr.genres` | array | Genre strings | Series-level |
| `sonarr.season.monitored` | boolean | Whether this season is monitored | Season-level |
| `sonarr.season.season_number` | number | Season number | Season-level |
| `sonarr.season.episode_count` | number | Total episodes in the season | Season-level |
| `sonarr.season.episode_file_count` | number | Episodes with files downloaded | Season-level |
| `sonarr.season.size_on_disk` | number | Season file size in bytes | Season-level |
| `sonarr.season.has_file` | boolean | Whether the season has any episode files | Derived from episode_file_count > 0. Season-level |

### Jellyfin Fields

Available on both targets. Requires `services.jellyfin` to be configured.

| Field | Type | Description | Notes |
|---|---|---|---|
| `jellyfin.watched_by` | array | Usernames who have watched | Absent if never played in Jellyfin — rules using this field will be skipped for that item. |
| `jellyfin.watched_by_all` | boolean | True if all Jellyfin users have watched | Same skipping behavior as above. |
| `jellyfin.last_played` | date | Last playback timestamp | Can be null. |
| `jellyfin.play_count` | number | Total play count across all users | |

### Jellyseerr Fields

Available on both targets. Requires `services.jellyseerr` to be configured.

| Field | Type | Description | Notes |
|---|---|---|---|
| `jellyseerr.requested_by` | string | Username who requested the media | Absent if not requested through Jellyseerr. |
| `jellyseerr.requested_at` | date | When the request was made | |
| `jellyseerr.request_status` | string | Request status | |

### State Fields

Computed locally from Roombarr's evaluation history. Available on `target: radarr` only.

| Field | Type | Description | Notes |
|---|---|---|---|
| `state.import_list_removed_at` | date | When the item was last removed from all import lists | Null if the item has never been removed from an import list, or on the first evaluation run. |
| `state.ever_on_import_list` | boolean | Whether the item was ever on an import list | False on the first evaluation run. |

> State fields require at least two evaluation runs spaced apart to produce meaningful values. On the first run, Roombarr has no historical data to compute these fields.

## API

Roombarr exposes a small HTTP API for health checks and on-demand evaluations.

### `GET /health`

Returns the service status and version.

```
HTTP/1.1 200 OK

{
  "status": "ok",
  "version": "x.y.z"
}
```

### `POST /evaluate`

Triggers an evaluation run asynchronously. Returns immediately with a run ID you can use to poll for results.

**Started successfully:**

```
HTTP/1.1 202 Accepted

{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running"
}
```

**Already running:**

```
HTTP/1.1 409 Conflict

{
  "statusCode": 409,
  "message": "An evaluation is already running"
}
```

A 409 is returned if a scheduled or previous manual run is still in progress.

### `GET /evaluate/:runId`

Poll for evaluation results by run ID.

**Still running:**

```
HTTP/1.1 202 Accepted

{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "started_at": "2026-02-17T03:00:00.000Z"
}
```

**Completed:**

```
HTTP/1.1 200 OK

{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "started_at": "2026-02-17T03:00:00.000Z",
  "completed_at": "2026-02-17T03:00:12.000Z",
  "dry_run": true,
  "summary": {
    "items_evaluated": 150,
    "items_matched": 12,
    "actions": {
      "keep": 2,
      "unmonitor": 5,
      "delete": 5
    },
    "rules_skipped_missing_data": 3
  },
  "results": [
    {
      "title": "Old Movie",
      "type": "movie",
      "external_id": 12345,
      "matched_rules": ["Delete fully watched old movies"],
      "resolved_action": "delete",
      "dry_run": true
    }
  ]
}
```

**Notes:**
- The `results` array only includes items where `resolved_action` is non-null. Items that matched no rules are excluded. Use `summary.items_evaluated` for the total count.
- Only the last 10 evaluation runs are kept in memory. Older runs are evicted and will return `404 Not Found`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PUID` | `1000` | User ID for file permissions — see [Understanding PUID and PGID](https://docs.linuxserver.io/general/understanding-puid-and-pgid/) |
| `PGID` | `1000` | Group ID for file permissions |
| `CONFIG_PATH` | `/config/roombarr.yml` | Path to the YAML config file |
| `PORT` | `3000` | HTTP server listen port |
| `TZ` | _(UTC)_ | Timezone for cron schedule evaluation (e.g., `America/New_York`) |
| `NODE_ENV` | `production` | Controls log format. Set to `development` for pretty-printed logs. |

## Troubleshooting

**Container exits immediately on startup:** Configuration validation failed. Run `docker compose logs roombarr` to see the specific error. Common causes include missing a required service for a rule target, invalid YAML syntax, unknown field paths, or using an incompatible operator for a field type.

**Rules match nothing:** Check the `rules_skipped_missing_data` count in the evaluation summary. If enrichment services (Jellyfin or Jellyseerr) are unreachable during a run, all rules referencing their fields are silently skipped. Check the container logs for connection errors.

**State fields don't match on first run:** This is expected. State fields (`state.*`) require at least two evaluation runs to produce values. On the first run, they return null and any rules using them will not match.

**409 when triggering a manual evaluation:** A scheduled or previous manual run is still in progress. Wait for it to complete before triggering another.

**Old run ID returns 404:** Only the last 10 evaluation runs are kept in memory. Older runs are evicted.

**Schedule fires at the wrong time:** The cron expression evaluates in the timezone set by the `TZ` environment variable. If `TZ` is not set, it defaults to UTC.
