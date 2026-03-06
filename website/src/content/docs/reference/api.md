---
title: API
description: HTTP endpoints including /health and /evaluate.
---

Roombarr exposes a small HTTP API on port `3000`. There is no built-in authentication — secure access at the network level (e.g., Docker network, reverse proxy, firewall rules).

Evaluations are **asynchronous** — `POST /evaluate` returns immediately with a run ID, and the evaluation executes in the background. Use `GET /evaluate/:runId` to poll for results. The port is configurable via the [`PORT` environment variable](/roombarr/reference/environment-variables/#port).

The API has two functional areas:

- **Health** — a single endpoint for uptime monitoring
- **Evaluation** — trigger and poll evaluation runs programmatically

## `GET /health`

Returns the current health status and version.

```bash
curl http://localhost:3000/health
```

**200 OK**

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `string` | Always `"ok"` when the service is running |
| `version` | `string` | The current Roombarr version from `package.json` |

:::note
The health endpoint is excluded from request logging to keep logs clean when used with frequent polling (e.g., Docker health checks, uptime monitors).
:::

## `POST /evaluate`

Triggers a new evaluation run. The evaluation happens asynchronously — the endpoint returns immediately and the run executes in the background.

```bash
curl -X POST http://localhost:3000/evaluate
```

**202 Accepted** — evaluation started

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running"
}
```

**409 Conflict** — an evaluation is already in progress

```json
{
  "statusCode": 409,
  "message": "An evaluation is already running"
}
```

:::tip
You don't need to wait for one evaluation to finish before checking results. Use the `run_id` from the 202 response to [poll for results](#get-evaluaterunid) while the evaluation runs.
:::

## `GET /evaluate/:runId`

Returns the status and results of an evaluation run. The response shape and status code depend on the run's current state.

```bash
curl http://localhost:3000/evaluate/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Still running

**202 Accepted**

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "started_at": "2026-03-05T03:00:00.000Z"
}
```

### Completed or failed

**200 OK**

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "started_at": "2026-03-05T03:00:00.000Z",
  "completed_at": "2026-03-05T03:00:12.345Z",
  "dry_run": true,
  "summary": {
    "items_evaluated": 142,
    "items_matched": 7,
    "actions": {
      "delete": 5,
      "unmonitor": 2,
      "keep": 0
    },
    "rules_skipped_missing_data": 0
  },
  "results": [
    {
      "title": "Old Movie (2019)",
      "type": "movie",
      "internal_id": "movie:42",
      "external_id": 42,
      "matched_rules": ["Delete old unwatched movies"],
      "resolved_action": "delete",
      "dry_run": true,
      "execution_status": "skipped"
    }
  ]
}
```

### Not found

**404 Not Found**

```json
{
  "statusCode": 404,
  "message": "Evaluation run a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found"
}
```

:::note
Roombarr keeps the last **10 evaluation runs** in memory. Older runs are discarded automatically. For persistent history, use the audit log stored in the SQLite database.
:::

## Response reference

### `RunResponse`

The top-level response object returned by `GET /evaluate/:runId` for a completed run.

| Field | Type | Description |
|---|---|---|
| `run_id` | `string` | Unique identifier for this evaluation run |
| `status` | `"running" \| "completed" \| "failed"` | Current state of the run |
| `started_at` | `string` | ISO 8601 timestamp when the run started |
| `completed_at` | `string` | ISO 8601 timestamp when the run finished (absent while running) |
| `dry_run` | `boolean` | Whether the run executed in dry-run mode (absent while running) |
| `summary` | `EvaluationSummary` | Aggregate counts (absent while running) |
| `results` | `EvaluationItemResult[]` | Per-item detail (absent while running) |

When `status` is `"failed"`, the response includes an `error` field with a human-readable message describing what went wrong. Partial results may or may not be present depending on when the failure occurred.

:::note
The `results` array only includes items that matched at least one rule. Items that were evaluated but matched no rules are not included. Use `summary.items_evaluated` minus `summary.items_matched` to determine how many items were evaluated but didn't match.
:::

### `EvaluationSummary`

A high-level overview of the evaluation run, returned in the `summary` field of a completed run.

| Field | Type | Description |
|---|---|---|
| `items_evaluated` | `number` | Total items inspected across all configured services |
| `items_matched` | `number` | Items that matched at least one rule |
| `actions` | `Record<Action, number>` | Count of each [resolved action](/roombarr/configuration/actions/#conflict-resolution) |
| `rules_skipped_missing_data` | `number` | Rules skipped because an enrichment service was unavailable |
| `actions_executed` | `Record<Action, number>` | Count of each action successfully executed (**live mode only**) |
| `actions_failed` | `number` | Number of actions that failed during execution (**live mode only**) |

:::note
`actions_executed` and `actions_failed` only appear when `dry_run` is `false`. In dry-run mode, no actions are executed so these fields are omitted.
:::

### `EvaluationItemResult`

Per-item detail returned in the `results` array of a completed run.

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Display title of the item (movie title or series + season) |
| `type` | `"movie" \| "season"` | Whether this item is a Radarr movie or a Sonarr season |
| `internal_id` | `string` | Composite key unique per item (e.g., `"movie:42"`, `"season:10:1"`) |
| `external_id` | `number` | The item's ID in the source service (Radarr or Sonarr) |
| `matched_rules` | `string[]` | Names of all rules that matched this item |
| `resolved_action` | `Action \| null` | The winning action after [conflict resolution](/roombarr/configuration/actions/#conflict-resolution), or `null` if no rules matched |
| `dry_run` | `boolean` | Whether this item was evaluated in dry-run mode |
| `execution_status` | `ExecutionStatus` | Outcome of executing the resolved action (see below) |
| `execution_error` | `string` | Error message when `execution_status` is `"failed"` |

### `Action`

The action Roombarr takes on a matched item. When multiple rules match, the **least-destructive action wins**. See [Actions](/roombarr/configuration/actions/) for full details.

| Value | Priority | Description |
|---|---|---|
| `keep` | Highest | Protect the item — no API call is made |
| `unmonitor` | Medium | Stop monitoring for new downloads |
| `delete` | Lowest | Remove from the service and delete files from disk |

### `ExecutionStatus`

Describes the outcome of executing an action on an item. Present in both dry-run and live mode, but the possible values differ.

| Value | Mode | Description |
|---|---|---|
| `skipped` | Both | Action was not executed — either because `dry_run` is `true` or the resolved action is `keep` |
| `success` | Live only | Action was executed successfully |
| `failed` | Live only | Action execution failed (see `execution_error` for details) |
| `not_found` | Live only | The service returned 404 — the item was already gone, treated as a desired end state |

## Example: trigger and poll

A complete curl-based workflow showing the trigger → poll → completed flow.

**1. Trigger an evaluation**

```bash
curl -s -X POST http://localhost:3000/evaluate | jq
```

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running"
}
```

**2. Poll for results**

```bash
curl -s http://localhost:3000/evaluate/a1b2c3d4-e5f6-7890-abcd-ef1234567890 | jq
```

While the evaluation is still running, you'll get a `202`:

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "started_at": "2026-03-05T03:00:00.000Z"
}
```

**3. Get completed results**

Once the evaluation finishes, the same URL returns `200` with full results:

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "started_at": "2026-03-05T03:00:00.000Z",
  "completed_at": "2026-03-05T03:00:08.421Z",
  "dry_run": true,
  "summary": {
    "items_evaluated": 142,
    "items_matched": 7,
    "actions": {
      "delete": 5,
      "unmonitor": 2,
      "keep": 0
    },
    "rules_skipped_missing_data": 0
  },
  "results": [
    {
      "title": "Old Movie (2019)",
      "type": "movie",
      "internal_id": "movie:42",
      "external_id": 42,
      "matched_rules": ["Delete old unwatched movies"],
      "resolved_action": "delete",
      "dry_run": true,
      "execution_status": "skipped"
    },
    {
      "title": "TV Show S01",
      "type": "season",
      "internal_id": "season:10:1",
      "external_id": 10,
      "matched_rules": ["Unmonitor old seasons"],
      "resolved_action": "unmonitor",
      "dry_run": true,
      "execution_status": "skipped"
    }
  ]
}
```

In dry-run mode, every item has `execution_status: "skipped"` because no actions are actually executed. Once you set `dry_run: false` in your [configuration](/roombarr/configuration/overview/), the `summary` will include `actions_executed` and `actions_failed`, and each item's `execution_status` will reflect the actual outcome.

## Related pages

- [Getting Started](/roombarr/getting-started/) — first-time setup and your first evaluation
- [Configuration Overview](/roombarr/configuration/overview/) — full config reference including `dry_run`
- [Actions](/roombarr/configuration/actions/) — action types and conflict resolution
