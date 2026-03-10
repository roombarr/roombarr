---
title: API
description: HTTP endpoints for health checks and on-demand evaluations.
---

Roombarr exposes a small HTTP API for health checks and on-demand evaluations.

## Endpoints

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

**Completed (dry run):**

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
      "internal_id": "movie:12345",
      "external_id": 12345,
      "matched_rules": ["Delete fully watched old movies"],
      "resolved_action": "delete",
      "dry_run": true,
      "execution_status": "skipped"
    }
  ]
}
```

**Completed (live run):**

When `dry_run` is `false`, the summary includes execution counts and each result includes an execution status.

```
HTTP/1.1 200 OK

{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "started_at": "2026-02-17T03:00:00.000Z",
  "completed_at": "2026-02-17T03:00:12.000Z",
  "dry_run": false,
  "summary": {
    "items_evaluated": 150,
    "items_matched": 12,
    "actions": {
      "keep": 2,
      "unmonitor": 5,
      "delete": 5
    },
    "rules_skipped_missing_data": 3,
    "actions_executed": {
      "keep": 0,
      "unmonitor": 5,
      "delete": 4
    },
    "actions_failed": 1
  },
  "results": [
    {
      "title": "Old Movie",
      "type": "movie",
      "internal_id": "movie:12345",
      "external_id": 12345,
      "matched_rules": ["Delete fully watched old movies"],
      "resolved_action": "delete",
      "dry_run": false,
      "execution_status": "success"
    }
  ]
}
```

**Failed:**

```
HTTP/1.1 200 OK

{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "started_at": "2026-02-17T03:00:00.000Z",
  "completed_at": "2026-02-17T03:00:01.000Z",
  "dry_run": true,
  "summary": null,
  "results": []
}
```

A `failed` status means the evaluation itself encountered an error (e.g., all configured services were unreachable). Check the container logs for details.

**Notes:**

- The `results` array only includes items where `resolved_action` is non-null. Items that matched no rules are excluded. Use `summary.items_evaluated` for the total count.
- Each result includes an `internal_id` (e.g., `"movie:42"`, `"season:10:1"`) as a stable composite key.
- In live mode, `execution_status` is `"success"`, `"failed"`, or `"not_found"` (treated as a success — the item was already gone). In dry-run mode, it is `"skipped"`.
- If `execution_status` is `"failed"`, an `execution_error` string is present with the error message.
- Only the last 10 evaluation runs are kept in memory. Older runs are evicted and will return `404 Not Found`.
