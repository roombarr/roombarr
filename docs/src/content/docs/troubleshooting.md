---
title: Troubleshooting
description: Common issues and how to resolve them.
---

**Container exits immediately on startup:** Configuration validation failed. Run `docker compose logs roombarr` (or your platform's equivalent) to see the specific error. Common causes include missing a required service for a rule target, invalid YAML syntax, unknown field paths, or using an incompatible operator for a field type.

**Rules match nothing:** Check the `rules_skipped_missing_data` count in the evaluation summary. If enrichment services (Jellyfin or Jellyseerr) are unreachable during a run, all rules referencing their fields are silently skipped. Check the container logs for connection errors.

**State fields don't match on first run:** This is expected. State fields (`state.*`) require at least two evaluation runs to produce values. On the first run, they return null and any rules using them will not match.

**409 when triggering a manual evaluation:** A scheduled or previous manual run is still in progress. Wait for it to complete before triggering another.

**Old run ID returns 404:** Only the last 10 evaluation runs are kept in memory. Older runs are evicted.

**Schedule fires at the wrong time:** The cron expression evaluates in the timezone set by the `TZ` environment variable. If `TZ` is not set, it defaults to UTC.
