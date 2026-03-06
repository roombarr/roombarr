---
title: Jellyfin
description: Setup and available fields for Jellyfin enrichment.
---

Jellyfin is an **enrichment service** in Roombarr. It doesn't control what gets evaluated — that's the target's job (Radarr or Sonarr). Instead, it adds watch-history fields to each item during evaluation, enabling rules like "delete movies everyone has watched" or "unmonitor seasons nobody is watching."

You only need to configure Jellyfin if your rules reference `jellyfin.*` fields. If none of your rules use them, you can skip this entirely.

## Setup

Add a `jellyfin` block under `services` in your `roombarr.yml`:

```yaml
services:
  jellyfin:
    base_url: http://jellyfin:8096
    api_key: your-jellyfin-api-key
```

- **`base_url`** — The URL of your Jellyfin server. If Roombarr and Jellyfin are on the same Docker network, use the Docker service name (e.g., `http://jellyfin:8096`).
- **`api_key`** — A Jellyfin API key. Create one in Jellyfin under **Dashboard → API Keys**.

Roombarr validates your config at startup. If any rule references a `jellyfin.*` field but `services.jellyfin` is missing, Roombarr will refuse to start.

:::tip
If you see connection errors in the logs, verify that Roombarr can reach Jellyfin from inside the container. See [Docker > Verifying connectivity](/roombarr/deployment/docker/#verifying-connectivity) for how to test.
:::

## Evaluation model

Roombarr matches items between your *arr instance and Jellyfin using provider IDs:

- **Movies** are matched via **TMDB ID**
- **Seasons** are matched via **TVDB ID** + **season number**

Items that don't have the required provider IDs in both systems won't match, and their Jellyfin fields will be null. Rules referencing Jellyfin fields are [skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for those items — they won't error or match incorrectly.

### How fields are aggregated

The way Roombarr computes these fields depends on whether the item is a movie or a season.

#### Movies

Straightforward — each user's watch data maps directly to the movie:

- **`watched_by`** — Every user who has played the movie at least once
- **`play_count`** — Sum of all users' play counts
- **`last_played`** — The most recent play timestamp across all users
- **`watched_by_all`** — `true` when every active Jellyfin user appears in `watched_by`. Always `false` when there are zero active users (prevents vacuous truth).

#### Seasons

Season aggregation is stricter because it rolls up from episode-level data:

- **`watched_by`** — Only includes users who have watched **every episode** in the season. Watching 9 out of 10 episodes doesn't count.
- **`play_count`** — For each user, the **minimum** play count across all episodes in the season (then summed across users). This represents complete season watches, not partial ones.
- **`last_played`** — The most recent play timestamp across all episodes and all users.
- **`watched_by_all`** — `true` when every active Jellyfin user has watched every episode. Always `false` when there are zero active users.

:::note
The "all episodes" requirement for seasons means `watched_by` may be empty even if users have partially watched the season. If you want to check whether *anyone* has started watching, use `jellyfin.play_count` with `greater_than` instead.
:::

## Available fields

All Jellyfin fields are available on both `radarr` and `sonarr` targets.

| Field | Type | Description |
|---|---|---|
| `jellyfin.watched_by` | array | Usernames of Jellyfin users who have watched the item |
| `jellyfin.watched_by_all` | boolean | `true` if every active Jellyfin user has watched the item. Always `false` when there are zero active users. |
| `jellyfin.play_count` | number | Total play count across all users |
| `jellyfin.last_played` | date | Most recent playback timestamp across all users |

## Operators

Each field type determines which operators you can use. See [Fields > Operator compatibility](/roombarr/reference/fields/#operator-compatibility) for the full compatibility table, and [Operators](/roombarr/reference/operators/) for operator details and duration syntax.

## Missing data behavior

When Jellyfin has no data for an item (not in Jellyfin, missing provider IDs, or Jellyfin unreachable), all `jellyfin.*` fields are null and rules referencing them are **skipped** for that item. See [Rules > When rules are skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for details.

## Example rules

### Delete movies everyone has watched

Once every Jellyfin user has seen a movie and it's been around for a while, clean it up.

```yaml
- name: Delete fully watched movies
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
```

### Unmonitor watched seasons

Stop monitoring seasons that everyone has finished watching.

```yaml
- name: Unmonitor watched seasons
  target: sonarr
  action: unmonitor
  conditions:
    operator: AND
    children:
      - field: jellyfin.watched_by_all
        operator: equals
        value: true
```

### Keep unwatched movies

Protect movies that nobody has watched yet from other delete rules.

```yaml
- name: Keep unwatched movies
  target: radarr
  action: keep
  conditions:
    operator: AND
    children:
      - field: jellyfin.watched_by
        operator: is_empty
```

### Check if a specific user watched

Target rules based on whether a particular user has (or hasn't) watched something.

```yaml
- name: Delete movies after admin watched
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: jellyfin.watched_by
        operator: includes
        value: admin
      - field: radarr.added
        operator: older_than
        value: 3m
```

## Related pages

- [Jellyseerr](/roombarr/integrations/jellyseerr/) — Request metadata enrichment
- [Fields](/roombarr/reference/fields/) — Consolidated field reference across all services
- [Operators](/roombarr/reference/operators/) — Operator reference and duration syntax
- [Rules](/roombarr/configuration/rules/) — Condition trees and rule syntax
