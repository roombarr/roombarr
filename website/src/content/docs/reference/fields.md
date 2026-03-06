---
title: Fields
description: Consolidated cheat-sheet of all available fields across integrations.
---

Fields are the data points that rule conditions evaluate against. Every field uses **dot-notation** where the first segment identifies the source service — `radarr.added`, `jellyfin.play_count`, `state.days_off_import_list`, etc.

Which fields are available depends on the rule's `target`. Radarr rules can use `radarr.*` fields, and Sonarr rules can use `sonarr.*` fields. Both targets can also use enrichment fields ([`jellyfin.*`](/roombarr/integrations/jellyfin/), [`jellyseerr.*`](/roombarr/integrations/jellyseerr/)) when those services are configured. [State fields](#state) (`state.*`) are available on both targets, though the only state fields defined today track Radarr-specific data.

For the full rule syntax, see [Rules](/roombarr/configuration/rules/). For operator details and duration syntax, see [Operators](/roombarr/reference/operators/).

## All fields

### Radarr

Available when `target: radarr`. See [Radarr](/roombarr/integrations/radarr/) for full descriptions and usage notes.

| Field | Type |
|---|---|
| `radarr.added` | date |
| `radarr.digital_release` | date |
| `radarr.physical_release` | date |
| `radarr.size_on_disk` | number |
| `radarr.has_file` | boolean |
| `radarr.monitored` | boolean |
| `radarr.on_import_list` | boolean |
| `radarr.status` | string |
| `radarr.year` | number |
| `radarr.path` | string |
| `radarr.tags` | array |
| `radarr.genres` | array |
| `radarr.import_list_ids` | array |

### Sonarr

Available when `target: sonarr`. See [Sonarr](/roombarr/integrations/sonarr/) for full descriptions and per-season evaluation details.

| Field | Type | Level |
|---|---|---|
| `sonarr.status` | string | Series |
| `sonarr.year` | number | Series |
| `sonarr.path` | string | Series |
| `sonarr.tags` | array | Series |
| `sonarr.genres` | array | Series |
| `sonarr.season.monitored` | boolean | Season |
| `sonarr.season.season_number` | number | Season |
| `sonarr.season.episode_count` | number | Season |
| `sonarr.season.episode_file_count` | number | Season |
| `sonarr.season.size_on_disk` | number | Season |
| `sonarr.season.has_file` | boolean | Season |

### Jellyfin

Available on both targets when `services.jellyfin` is configured. See [Jellyfin](/roombarr/integrations/jellyfin/) for aggregation details and missing data behavior.

| Field | Type |
|---|---|
| `jellyfin.watched_by` | array |
| `jellyfin.watched_by_all` | boolean |
| `jellyfin.play_count` | number |
| `jellyfin.last_played` | date |

### Jellyseerr

Available on both targets when `services.jellyseerr` is configured. See [Jellyseerr](/roombarr/integrations/jellyseerr/) for matching details and missing data behavior.

| Field | Type |
|---|---|
| `jellyseerr.requested_by` | string |
| `jellyseerr.requested_at` | date |
| `jellyseerr.request_status` | string |

### State

Computed locally from Roombarr's own history. The state tracking system is generic and supports any target, but the only state fields defined today (`state.days_off_import_list`, `state.ever_on_import_list`) track Radarr-specific data. State fields require at least 2 runs to produce values — on the first run, they are null for all items. See [Rules > When rules are skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for how null state values are handled.

| Field | Type | Description |
|---|---|---|
| `state.days_off_import_list` | number | Days since the movie was removed from all import lists. Null when the movie is currently on an import list. |
| `state.ever_on_import_list` | boolean | Whether the movie was ever on any import list |

:::note
Unlike enrichment fields (`jellyfin.*`, `jellyseerr.*`), null state values do **not** cause a rule to be skipped. A null state value means the item has no recorded history — it's meaningful data, not missing data. See [Rules > When rules are skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for details.
:::

## Operator compatibility

Which operators can be used with which field types. This is validated at startup — an incompatible pairing will prevent Roombarr from starting. See [Operators](/roombarr/reference/operators/) for full operator descriptions and duration syntax.

| Field type | Compatible operators |
|---|---|
| `string` | `equals`, `not_equals` |
| `number` | `equals`, `not_equals`, `greater_than`, `less_than` |
| `boolean` | `equals`, `not_equals` |
| `date` | `older_than`, `newer_than` |
| `array` | `includes`, `not_includes`, `includes_all`, `is_empty`, `is_not_empty` |

## Service notes

- **Radarr null dates** — `radarr.digital_release` and `radarr.physical_release` can be null. See [Operators > Null handling](/roombarr/reference/operators/#null-handling).
- **Tag lowercasing** — Radarr and Sonarr tags are lowercased. Use `keep`, not `Keep`. See [Radarr > Tags](/roombarr/integrations/radarr/#tags).
- **Import list fields** — `radarr.on_import_list` is a boolean convenience field; `radarr.import_list_ids` gives specific list IDs.
- **Sonarr per-season evaluation** — Each season is evaluated independently. See [Sonarr > Per-season evaluation](/roombarr/integrations/sonarr/#per-season-evaluation).
- **Jellyfin / Jellyseerr enrichment** — These are enrichment services available on both targets. Null fields cause rules to be skipped for that item. See integration pages for details.
- **State fields** — Computed locally, require 2+ runs. Currently all state fields track Radarr-specific data. Null values do **not** cause rules to be skipped.

## Related pages

- [Operators](/roombarr/reference/operators/) — Operator reference, type compatibility, and duration syntax
- [Rules](/roombarr/configuration/rules/) — Condition trees and rule syntax
- [Radarr](/roombarr/integrations/radarr/) — Radarr field descriptions, null dates, and tags
- [Sonarr](/roombarr/integrations/sonarr/) — Sonarr field descriptions and per-season evaluation
- [Jellyfin](/roombarr/integrations/jellyfin/) — Watch history fields and aggregation details
- [Jellyseerr](/roombarr/integrations/jellyseerr/) — Request metadata fields
