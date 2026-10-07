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

## Safety

**Optional.** Bounds on a single evaluation. All have defaults; you only need this block to change them.

```yaml
safety:
  evaluation_timeout: 1h # default: 1h, max: ~24.8 days
  max_deletes_per_run: 50 # default: 50, null to disable
  protect_airing_seasons: true # default: true
```

`evaluation_timeout` is the wall-clock budget for one run. A run still going when it elapses is abandoned and the scheduler is released, so a single hung request can't stop Roombarr from ever running again. The abandoned run stops at its next step boundary and does not execute further actions.

`max_deletes_per_run` refuses a run that resolves more deletes than the limit — nothing is executed and an error is logged. A rule change or an upstream data shift can unprotect a large share of a library at once; refusing the run is recoverable, deleting it is not. Size it above your normal run and revisit it after a rule change: check a `dry_run` first, raise the limit deliberately for a one-off catch-up, then put it back.

`protect_airing_seasons` skips a Sonarr `delete` for any season that may still air. A Sonarr delete [unmonitors the season](#sonarr-deletes-also-unmonitor-the-season), so deleting an airing season would make Sonarr silently stop grabbing its new episodes. The guard skips a season when:

- it has a next episode scheduled (`sonarr.season.next_airing` is set), or
- Sonarr sent no statistics for it, because its airing status is unknown, or
- none of its episodes have aired yet (`sonarr.season.previous_airing` is not set) and the series is `continuing` or `upcoming`. This covers announced seasons whose episodes have no air dates yet. A series status Roombarr doesn't recognize is treated as still airing, and the run logs a warning naming it. Specials (season 0) are left out of this check, since they often carry undated episodes for years.

A not-yet-aired season stays protected even if it already has episode files on disk. The guard applies in dry runs as well, so a dry run shows exactly what a live run would skip.

A skipped delete still reports `delete` as its resolved action, with a reason naming the guard in the run results and the audit log, so it can't be mistaken for a rule that didn't match. The run summary counts these in `deletes_skipped_by_guard`, and they don't count toward `max_deletes_per_run`. The guard never affects `unmonitor` actions, movies, seasons of `ended` or `deleted` series that haven't aired, or seasons that have aired and have nothing scheduled, including ones that finished recently; use a [keep rule](#protecting-airing-and-recent-seasons) for those. Set it to `false` to delete airing seasons like any other.

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

| Target   | Evaluates                     | On delete                                             |
| -------- | ----------------------------- | ----------------------------------------------------- |
| `radarr` | Each movie independently      | Removes the movie and deletes files from disk         |
| `sonarr` | Each **season** independently | Unmonitors the season, then deletes its episode files |

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

The `is_empty`, `is_not_empty`, `is_set`, and `is_not_set` operators must **not** include a `value`. All other operators require one.

`is_set` and `is_not_set` work on any date field and check whether it has a value at all. Use them when null means something specific, such as `sonarr.season.next_airing` being null when no episode is scheduled. The other date operators keep their own null handling: `older_than` matches a null date and `newer_than` never does.

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
- **Unreachable service** — If a service a rule depends on cannot be reached, the whole run fails and nothing is executed. A skipped `keep` rule is an unprotected item, so Roombarr will not act on a library it could not fully see.

:::note
State fields (`state.*`) are exempt from skipping. A null state value means "no history yet" — it's meaningful data, not missing data.
:::

## Actions

| Action      | Description                                           |
| ----------- | ----------------------------------------------------- |
| `delete`    | Remove from Radarr/Sonarr and delete files from disk  |
| `unmonitor` | Stop monitoring for new downloads (files stay)        |
| `keep`      | Explicitly protect this item from other rules (no-op) |

### Sonarr deletes also unmonitor the season

A delete means the media is stale and unwanted, so Roombarr never leaves Radarr or Sonarr in a state where it would download that media again on its own. Deleting a movie removes it from Radarr entirely. Sonarr can't remove a single season, so a Sonarr `delete` unmonitors the season and then deletes its episode files. If the season stayed monitored, Sonarr would treat the episodes as missing and grab them again, and the next run would delete them again.

Only the matched season is unmonitored. The series itself, its new-season monitoring, and its other seasons are unchanged, so a continuing show still picks up new seasons. This is not configurable.

The unmonitor runs first. If it fails, no files are deleted and the action is reported as failed. If a file delete fails afterwards, the season is left unmonitored with some files still on disk. The next run finishes the delete as long as the season still matches the rule, so a rule that requires `sonarr.season.monitored` to be `true` won't retry it.

A season that resolves to `delete` but has no episode files is still unmonitored. A season that is already empty and unmonitored but still matches a `delete` rule resolves to `delete` on every run. It is unmonitored again each time, which does no harm, but it counts toward `safety.max_deletes_per_run` each time.

:::caution[Upgrading from 0.2.3 or earlier]
Earlier versions deleted season files without unmonitoring, so seasons they emptied may still be monitored in Sonarr. Any of those that still match a `delete` rule are unmonitored on the next run. Any that no longer match a rule must be unmonitored by hand in Sonarr.

Empty seasons that resolve to `delete` count toward [`safety.max_deletes_per_run`](#safety), so the first run after upgrading can exceed the limit and abort. If it does, review the pending list in a `dry_run`, then raise the limit for that one run.

Seasons that are empty and already unmonitored keep counting toward the limit on later runs too. To stop this, add a condition to your Sonarr `delete` rules that matches only seasons with files, or monitored seasons that have already aired:

```yaml
- operator: OR
  children:
    - field: sonarr.season.has_file
      operator: equals
      value: true
    - operator: AND
      children:
        - field: sonarr.season.monitored
          operator: equals
          value: true
        - field: sonarr.season.previous_airing
          operator: is_set
```

Don't use `sonarr.season.monitored` equals `true` on its own here. Upcoming seasons are monitored and empty, so it would match every one of them. Pair this with the [recommended keep rule](#protecting-airing-and-recent-seasons), so a season whose latest episode aired recently but hasn't downloaded yet isn't deleted.
:::

### Protecting airing and recent seasons

We recommend this keep rule for every Sonarr setup. It keeps any season with an episode scheduled, and any season whose latest episode aired within the last 30 days:

```yaml
- name: Keep airing and recent seasons
  target: sonarr
  action: keep
  conditions:
    operator: OR
    children:
      - field: sonarr.season.next_airing
        operator: is_set
      - field: sonarr.season.previous_airing
        operator: newer_than
        value: 30d
```

[`safety.protect_airing_seasons`](#safety) already stops deletes of seasons with a scheduled episode or that haven't started airing, even without this rule. The keep rule goes further: it also covers recently finished seasons, and it protects against `unmonitor` rules, which the guard doesn't touch.

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
