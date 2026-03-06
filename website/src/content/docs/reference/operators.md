---
title: Operators
description: All operators, supported types, and duration syntax.
---

Operators define how a condition compares a field's value against a target value. Each operator is only compatible with specific [field types](/roombarr/reference/fields/), and Roombarr validates this at startup. For how operators fit into the condition tree, see [Rules](/roombarr/configuration/rules/).

## Operator reference

| Operator | Compatible types | Value | Description |
|---|---|---|---|
| `equals` | string, number, boolean | Same as field type | Strict equality (`===`) |
| `not_equals` | string, number, boolean | Same as field type | Strict inequality (`!==`) |
| `greater_than` | number | number | Greater-than comparison. Null fields never match. |
| `less_than` | number | number | Less-than comparison. Null fields never match. |
| `older_than` | date | Duration string | True if the date is further in the past than the duration. Null dates **always** match. |
| `newer_than` | date | Duration string | True if the date is within the duration. Null dates **never** match. |
| `includes` | array | string | Array contains the value. |
| `not_includes` | array | string | Array does not contain the value. |
| `includes_all` | array | string[] | Array contains **every** value in the list. |
| `is_empty` | array | _(none)_ | Array has zero elements. Do not include a `value` key. |
| `is_not_empty` | array | _(none)_ | Array has one or more elements. Do not include a `value` key. |

## Type compatibility

Every field in Roombarr has one of five types. Operators are restricted to the types listed below.

| Field type | Compatible operators |
|---|---|
| `string` | `equals`, `not_equals` |
| `number` | `equals`, `not_equals`, `greater_than`, `less_than` |
| `boolean` | `equals`, `not_equals` |
| `date` | `older_than`, `newer_than` |
| `array` | `includes`, `not_includes`, `includes_all`, `is_empty`, `is_not_empty` |

Roombarr validates operator-to-type compatibility when it loads your configuration. If a condition pairs an operator with an incompatible field type, Roombarr will refuse to start and log an error explaining the mismatch.

## Null handling

When a field's value is null or undefined — for example, when an enrichment service has no data for a given item — operators behave as follows:

| Operator | Null behavior | Rationale |
|---|---|---|
| `equals` | `null === value` — only matches if value is also null | Standard strict equality |
| `not_equals` | `null !== value` — matches unless value is null | Standard strict inequality |
| `greater_than` | Never matches | Can't compare null numerically |
| `less_than` | Never matches | Can't compare null numerically |
| `older_than` | **Always matches** | A null date is treated as infinitely old |
| `newer_than` | **Never matches** | A null date can't be newer than anything |
| `includes` | Never matches | Null is not an array |
| `not_includes` | Never matches | Null is not an array |
| `includes_all` | Never matches | Null is not an array |
| `is_empty` | Never matches | Null is not an array |
| `is_not_empty` | Never matches | Null is not an array |

:::caution[`older_than` matches null dates]
The `older_than` operator intentionally matches null dates. This means a condition like `jellyfin.last_played older_than 6m` will match items that have **never** been played. To exclude unplayed items, add a guard condition that ensures the field has data:

```yaml
conditions:
  operator: AND
  children:
    - field: jellyfin.watched_by
      operator: is_not_empty       # Guard: skip items with no Jellyfin data
    - field: jellyfin.last_played
      operator: older_than
      value: 6m
```

Note that if `jellyfin.watched_by` is null (no enrichment data for this item), the `is_not_empty` condition won't match and the rule will be [skipped for that item](/roombarr/configuration/rules/#when-rules-are-skipped) entirely — which is the safe behavior you want.
:::

:::caution[`not_includes` and `is_empty` never match null]
Both `not_includes` and `is_empty` return false when the field is null. This means items with no data for an array field are silently excluded — they won't match a `not_includes` or `is_empty` condition. If your rule depends on the *absence* of a value, be aware that items without enrichment data will be skipped rather than matched.
:::

## Duration syntax

The `older_than` and `newer_than` operators accept a **duration string** instead of a raw date. The format is `<number><unit>`:

| Unit | Suffix | Example | Meaning |
|---|---|---|---|
| Minutes | `min` | `45min` | 45 minutes ago |
| Days | `d` | `30d` | 30 days ago |
| Weeks | `w` | `2w` | 2 weeks ago |
| Months | `m` | `6m` | 6 months ago |
| Years | `y` | `1y` | 1 year ago |

Duration strings are case-sensitive. `6m` means 6 months — `6M` is invalid and will fail validation.

At evaluation time, Roombarr subtracts the duration from the current UTC time to produce a threshold date, then compares the field value against that threshold.

## Examples

### Equality operators

```yaml
# String equality
- field: radarr.status
  operator: equals
  value: released

# Boolean equality
- field: radarr.monitored
  operator: not_equals
  value: true
```

### Numeric comparisons

```yaml
# Movies added before 2010
- field: radarr.year
  operator: less_than
  value: 2010

# Seasons with more than 20 episodes
- field: sonarr.season.episode_count
  operator: greater_than
  value: 20
```

### Date operators

```yaml
# Added more than 6 months ago
- field: radarr.added
  operator: older_than
  value: 6m

# Played within the last 2 weeks
- field: jellyfin.last_played
  operator: newer_than
  value: 2w
```

### Array operators

```yaml
# Tagged with "keep"
- field: radarr.tags
  operator: includes
  value: keep

# Not tagged "temporary"
- field: radarr.tags
  operator: not_includes
  value: temporary

# Has all required tags
- field: radarr.tags
  operator: includes_all
  value:
    - 4k
    - hdr

# Nobody has watched it
- field: jellyfin.watched_by
  operator: is_empty

# At least one person has watched it
- field: jellyfin.watched_by
  operator: is_not_empty
```

## Related pages

- [Fields](/roombarr/reference/fields/) — Every field available for conditions with type information
- [Rules](/roombarr/configuration/rules/) — Condition trees and rule syntax
