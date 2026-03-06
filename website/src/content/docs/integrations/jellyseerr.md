---
title: Jellyseerr
description: Setup and available fields for Jellyseerr enrichment.
---

Jellyseerr is an **enrichment service** in Roombarr. It adds request metadata — who requested media, when, and its approval status — to each item during evaluation. This enables rules like "delete approved requests nobody watched" or "keep media that's still pending approval."

You only need to configure Jellyseerr if your rules reference `jellyseerr.*` fields. If none of your rules use them, you can skip this entirely. Roombarr lazily fetches Jellyseerr data only when at least one rule references a `jellyseerr.*` field.

## Setup

Add a `jellyseerr` block under `services` in your `roombarr.yml`:

```yaml
services:
  jellyseerr:
    base_url: http://jellyseerr:5055
    api_key: your-jellyseerr-api-key
```

- **`base_url`** — The URL of your Jellyseerr instance. If Roombarr and Jellyseerr are on the same Docker network, use the Docker service name (e.g., `http://jellyseerr:5055`).
- **`api_key`** — A Jellyseerr API key. Create one in Jellyseerr under **Settings → General → API Key**.

Roombarr validates your config at startup. If any rule references a `jellyseerr.*` field but `services.jellyseerr` is missing, Roombarr will refuse to start.

:::tip
If you see connection errors in the logs, verify that Roombarr can reach Jellyseerr from inside the container. See [Docker > Verifying connectivity](/roombarr/deployment/docker/#verifying-connectivity) for how to test.
:::

## Evaluation model

Roombarr matches items between your *arr instance and Jellyseerr using provider IDs:

- **Movies** are matched via **TMDB ID**
- **TV shows** are matched via **TVDB ID** (series-level)

:::note
Jellyseerr requests are tracked at the **series level**, not the season level. All seasons of a series share the same Jellyseerr request data — the same `requested_by`, `requested_at`, and `request_status` values. This differs from Jellyfin, which can have per-season watch data.
:::

Items that don't have a matching request in Jellyseerr will have null `jellyseerr.*` fields. Rules referencing Jellyseerr fields are [skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for those items — they won't error or match incorrectly.

## Available fields

All Jellyseerr fields are available on both `radarr` and `sonarr` targets.

| Field | Type | Description |
|---|---|---|
| `jellyseerr.requested_by` | string | Username of the Jellyseerr user who requested the media |
| `jellyseerr.requested_at` | date | When the request was created. Null dates match `older_than` — see [Operators > Null handling](/roombarr/reference/operators/#null-handling). |
| `jellyseerr.request_status` | string | `pending`, `approved`, `declined`, or `unknown` |

The `request_status` values map directly from Jellyseerr's internal status codes. Items with an unrecognized status code will show `unknown`.

## Operators

Each field type determines which operators you can use. See [Fields > Operator compatibility](/roombarr/reference/fields/#operator-compatibility) for the full compatibility table, and [Operators](/roombarr/reference/operators/) for operator details and duration syntax.

## Missing data behavior

When Jellyseerr has no data for an item (no matching request, missing provider IDs, or Jellyseerr unreachable), all `jellyseerr.*` fields are null and rules referencing them are **skipped** for that item. See [Rules > When rules are skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for details.

## Example rules

### Delete stale approved requests

Remove movies that were requested and approved over a year ago but nobody has watched. This combines Jellyseerr and [Jellyfin](/roombarr/integrations/jellyfin/) fields.

```yaml
- name: Delete stale approved requests
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: jellyseerr.request_status
        operator: equals
        value: approved
      - field: jellyseerr.requested_at
        operator: older_than
        value: 1y
      - field: jellyfin.watched_by
        operator: is_empty
```

### Keep pending requests

Protect media that's still awaiting approval from being deleted by other rules. Because `keep` wins [conflict resolution](/roombarr/configuration/actions/#conflict-resolution), this overrides any `delete` rules that match the same item.

```yaml
- name: Keep pending requests
  target: radarr
  action: keep
  conditions:
    operator: AND
    children:
      - field: jellyseerr.request_status
        operator: equals
        value: pending
```

## Related pages

- [Jellyfin](/roombarr/integrations/jellyfin/) — Watch history enrichment
- [Fields](/roombarr/reference/fields/) — Consolidated field reference across all services
- [Operators](/roombarr/reference/operators/) — Operator reference and duration syntax
- [Rules](/roombarr/configuration/rules/) — Condition trees and rule syntax
