---
title: Rules
description: Rule syntax, targets, and condition trees with AND/OR logic.
---

Rules are the core building block of your Roombarr configuration. Each rule lives in the `rules` array and combines a **target** (which service to evaluate), **conditions** (what to check), and an **action** (what to do when conditions match). You need at least one rule, and you can define as many as you like.

For the complete list of fields you can reference in conditions, see [Fields](/roombarr/reference/fields/). For operator details and type compatibility, see [Operators](/roombarr/reference/operators/).

## Anatomy of a rule

Every rule has four top-level keys:

```yaml
rules:
  - name: Delete fully watched old movies  # Human-readable label (must be unique)
    target: radarr                          # Which service to evaluate against
    action: delete                          # What to do when conditions match
    conditions:                             # AND/OR condition tree
      operator: AND
      children:
        - field: jellyfin.watched_by_all
          operator: equals
          value: true
        - field: radarr.added
          operator: older_than
          value: 6m
```

- **`name`** — A unique, human-readable label. It appears in logs and the audit trail.
- **`target`** — Either `radarr` or `sonarr`. Determines what items the rule evaluates and which fields are valid.
- **`action`** — One of `delete`, `unmonitor`, or `keep`. See [Actions](/roombarr/configuration/actions/) for full details.
- **`conditions`** — A condition group (AND/OR tree) that determines whether the rule matches a given item.

## Targets

A rule's `target` determines what Roombarr iterates over during evaluation.

| Target | Evaluates | On delete |
|---|---|---|
| `radarr` | Each movie independently | Removes the movie and deletes files from disk |
| `sonarr` | Each **season** independently | Deletes episode files for that season only |

The sonarr target evaluates at the season level, not the series level. A delete action on a sonarr rule removes that season's files — the series itself and all other seasons are left untouched.

The target also constrains which fields are valid in conditions. Radarr rules can use `radarr.*` fields, and sonarr rules can use `sonarr.*` fields. Both targets can use enrichment fields (`jellyfin.*`, `jellyseerr.*`). State fields (`state.*`) are currently **Radarr-only** — see [Fields > State](/roombarr/reference/fields/#state) for details.

```yaml
# Sonarr rules can mix series-level and season-level fields
- name: Unmonitor empty seasons of ended series
  target: sonarr
  action: unmonitor
  conditions:
    operator: AND
    children:
      - field: sonarr.status          # Series-level field
        operator: equals
        value: ended
      - field: sonarr.season.has_file  # Season-level field
        operator: equals
        value: false
```

## Conditions

Conditions form a tree of checks that Roombarr evaluates against each item. The tree has two node types: **groups** (AND/OR combinators) and **leaves** (individual field checks).

### Condition groups

A group combines one or more children with a logical operator. The top-level `conditions` key on every rule is always a group.

```yaml
# All children must match (AND)
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
# At least one child must match (OR)
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

A group requires at least one child. The `operator` field is case-sensitive and must be uppercase `AND` or `OR`.

### Leaf conditions

A leaf condition checks a single field against a value using an operator.

```yaml
- field: radarr.year         # Dotted field path
  operator: less_than        # Comparison operator
  value: 2010                # Value to compare against
```

- **`field`** — A dotted path referencing a field from the target or an enrichment service.
- **`operator`** — The comparison to perform. Must be compatible with the field's type.
- **`value`** — The value to compare against. Omit this for `is_empty` and `is_not_empty`.

The `is_empty` and `is_not_empty` operators work on array fields and must **not** include a `value`. All other operators require one. Roombarr validates this at startup and will refuse to start if the shape is wrong.

### Nesting groups

Children can be groups or leaves — you can nest to arbitrary depth. This lets you express complex logic like "A AND (B OR C)":

```yaml
conditions:
  operator: AND
  children:
    # Leaf: movie must be unmonitored
    - field: radarr.monitored
      operator: equals
      value: false
    # Nested group: EITHER watched by everyone OR added over 2 years ago
    - operator: OR
      children:
        - field: jellyfin.watched_by_all
          operator: equals
          value: true
        - field: radarr.added
          operator: older_than
          value: 2y
```

In plain English: "Delete unmonitored movies that have either been watched by everyone **or** were added more than two years ago."

## Fields

Fields use a dot-notation naming convention where the first segment identifies the source service. The target's own fields use the target name as a prefix (e.g., `radarr.added`), and enrichment services use their own name (e.g., `jellyfin.watched_by`).

Fields from enrichment services (`jellyfin.*`, `jellyseerr.*`) require the corresponding service to be configured under `services`. Roombarr validates this at startup — if a rule references `jellyfin.watched_by` but `services.jellyfin` is missing, it will refuse to start.

For the complete field list per target, see [Fields](/roombarr/reference/fields/).

## Operators

Each operator is compatible with specific field types. For example, `older_than` and `newer_than` work only with date fields, while `includes` works only with array fields. The `is_empty` and `is_not_empty` operators are special — they take no value and only work with array fields. All other operators require a `value`.

For the full operator reference including duration syntax and the operator-to-type compatibility matrix, see [Operators](/roombarr/reference/operators/).

## Conflict resolution

When multiple rules match the same item, the least-destructive action wins (`keep > unmonitor > delete`). Rule order in your configuration file does not matter — only the action priority counts. See [Actions > Conflict Resolution](/roombarr/configuration/actions/#conflict-resolution) for details and examples.

## When rules are skipped

Roombarr skips a rule for a specific item when the data it needs is missing. This is a safety mechanism — it prevents rules from acting on incomplete information.

A rule is skipped when:

1. **Enrichment data is missing for that item.** If a rule references `jellyfin.*` fields and Jellyfin returned no data for a particular movie, the rule is skipped for that movie only. Other movies with Jellyfin data are still evaluated.
2. **An enrichment service is unreachable during a run.** If Jellyfin is down, all items will have null Jellyfin data. Every rule referencing Jellyfin fields is skipped for every item in that run.

```yaml
# This rule uses both jellyfin and state fields
- name: Delete movies dropped from import list
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: state.days_off_import_list
        operator: greater_than
        value: 30
      - field: jellyfin.play_count
        operator: equals
        value: 0
```

:::note
State fields (`state.*`) are exempt from the skip rule. Unlike enrichment services that fetch data from external APIs, state is computed locally from Roombarr's own database. A null state value is meaningful — it means the item has no recorded history — rather than indicating missing data. On first run, state fields will be null for all items until Roombarr builds up history over subsequent runs.
:::

## Examples

### Delete stale unwatched Jellyseerr requests

Remove seasons that were requested over a year ago and nobody has watched.

```yaml
- name: Delete stale unwatched requests
  target: sonarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: jellyseerr.requested_at
        operator: older_than
        value: 1y
      - field: jellyfin.watched_by
        operator: is_empty
```

### Unmonitor empty seasons of ended series

Stop monitoring seasons with no downloaded files on shows that have finished airing.

```yaml
- name: Unmonitor empty ended seasons
  target: sonarr
  action: unmonitor
  conditions:
    operator: AND
    children:
      - field: sonarr.status
        operator: equals
        value: ended
      - field: sonarr.season.has_file
        operator: equals
        value: false
```

### Delete old unmonitored movies

Clean up movies that are no longer monitored and were added a long time ago. This rule uses only Radarr fields — no enrichment services required.

```yaml
- name: Delete old unmonitored movies
  target: radarr
  action: delete
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

### Keep anything tagged for protection

Protect items tagged "keep" from all other rules. Works for both Radarr and Sonarr — define one rule per target.

```yaml
- name: Protect tagged movies
  target: radarr
  action: keep
  conditions:
    operator: AND
    children:
      - field: radarr.tags
        operator: includes
        value: keep

- name: Protect tagged series
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

- [Actions](/roombarr/configuration/actions/) — Action types and conflict resolution
- [Fields](/roombarr/reference/fields/) — Every field available for conditions
- [Operators](/roombarr/reference/operators/) — Operator reference and duration syntax
- [Config Recipes](/roombarr/recipes/) — Complete working configs for common scenarios
