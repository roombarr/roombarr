---
title: Actions
description: Available actions (delete, unmonitor, keep) and conflict resolution.
---

Every rule must specify an `action` — the operation Roombarr performs on items that match the rule's conditions. There are three available actions:

| Action | Description |
|---|---|
| `delete` | Remove from Radarr/Sonarr and delete files from disk |
| `unmonitor` | Stop monitoring for new downloads |
| `keep` | Explicitly protect this item from other rules |

## `delete`

Removes the matched item and its files. Behavior differs by target:

- **Radarr** — removes the movie from Radarr and deletes all associated files from disk.
- **Sonarr** — deletes episode files for the matched season only. The series itself and all other seasons are left untouched.

```yaml
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
```

## `unmonitor`

Stops Roombarr's target service from searching for new downloads. No files are deleted.

- **Radarr** — sets `monitored: false` on the movie. Existing files remain on disk.
- **Sonarr** — sets `monitored: false` on the matched season only. Other seasons and the series itself are not affected.

```yaml
- name: Unmonitor old seasons
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

## `keep`

The `keep` action never triggers an API call — it is a no-op by design. Its only purpose is to win [conflict resolution](#conflict-resolution) and protect items from destructive actions defined in other rules.

Use `keep` rules to carve out exceptions to broad cleanup rules:

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

## Conflict resolution

When multiple rules match the same item, each rule may specify a different action. Roombarr resolves the conflict using a **least-destructive-wins** strategy:

**`keep` > `unmonitor` > `delete`**

The safest action always takes priority. For example, suppose a movie matches two rules:

| Rule | Action |
|---|---|
| Delete old watched movies | `delete` |
| Protect import list movies | `keep` |

The resolved action is **`keep`** — the movie is protected. The audit log records both matched rules so the conflict is visible.

> This means you can write broad cleanup rules and then add targeted `keep` rules to protect specific items — the `keep` rules will always win.

## Dry-run behavior

When `dry_run` is `true`, no actions are executed. See [Configuration Overview](/roombarr/configuration/overview/#dry_run) for details.

## Related pages

- [Rules](/roombarr/configuration/rules/) — Condition trees and rule syntax
- [Fields](/roombarr/reference/fields/) — Every field available for conditions
- [Config Recipes](/roombarr/recipes/) — Complete working configs demonstrating actions in practice
