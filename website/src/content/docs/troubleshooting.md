---
title: Troubleshooting
description: Common issues, debugging steps, and solutions for Roombarr.
---

When something isn't working as expected, start with the container logs:

```bash
docker compose logs roombarr
```

Roombarr logs are structured and will usually point you directly at the problem. Below are the most common issues and how to fix them.

## Container won't start

Roombarr validates your entire configuration at startup and refuses to start if anything is invalid. Check the logs — the error message will tell you exactly what's wrong.

**Common causes:**

- **Missing required service** — Your rules reference a target (`radarr` or `sonarr`) that isn't configured under `services`. Every rule's `target` must have a matching service.
- **Missing enrichment service** — A rule uses `jellyfin.*` or `jellyseerr.*` fields, but the corresponding service isn't configured. Add it to `services` or remove the field from your rule.
- **Invalid YAML syntax** — Indentation errors, missing colons, or unquoted special characters. See [common YAML mistakes](#common-yaml-mistakes) below.
- **Incompatible operator** — An operator paired with the wrong field type (e.g., `older_than` on a boolean field). See the [type compatibility matrix](/roombarr/reference/fields/#type-to-operator-compatibility).
- **Unknown field path** — A typo in a field name like `radarr.add` instead of `radarr.added`.
- **Bad cron expression** — The `schedule` value must be a valid 5-field cron expression.

```bash
# Example error output
roombarr  | ERROR: Configuration validation failed
roombarr  | - rules[0].conditions.children[0]: Unknown field "radarr.add"
```

## Rules match nothing

If your evaluation summary shows zero matches when you expect results, check these things in order:

1. **Check `rules_skipped_missing_data`** — This counter in the evaluation summary tells you how many rule-item pairs were skipped because enrichment data was missing. A high number usually means Jellyfin or Jellyseerr is unreachable.

2. **Check the container logs for connection errors** — Look for failed HTTP requests to your services:
   ```bash
   docker compose logs roombarr | grep -i "error\|failed\|ECONNREFUSED"
   ```

3. **Verify service connectivity** — Make sure Roombarr can reach your services from inside the Docker network:
   ```bash
   docker compose exec roombarr wget -qO- 'http://radarr:7878/api/v3/health?apikey=YOUR_KEY'
   ```

4. **Check your conditions** — Rules require *all* conditions to match (for AND groups). A single condition that never matches will prevent the entire rule from matching. Try simplifying to a single condition and adding complexity back one condition at a time.

5. **Check `older_than` / `newer_than` values** — Remember that `m` means months, not minutes. `6m` is 6 months. See [duration syntax](/roombarr/reference/operators/#duration-syntax).

## State fields don't match on first run

This is expected behavior. State fields (`state.days_off_import_list`, `state.ever_on_import_list`) are computed from Roombarr's own evaluation history. On the first run, there is no history — these fields return null for all items and rules using them will not match.

After two or more evaluation runs spaced apart, state fields will start producing meaningful values. If you're testing a new setup, trigger a couple of manual evaluations:

```bash
curl -X POST http://localhost:3000/evaluate
# Wait for it to complete, then trigger another
curl -X POST http://localhost:3000/evaluate
```

See [Rules > When rules are skipped](/roombarr/configuration/rules/#when-rules-are-skipped) for details on how null state values are handled.

## 409 when triggering a manual evaluation

```json
{
  "statusCode": 409,
  "message": "An evaluation is already running"
}
```

Only one evaluation can run at a time. This 409 means a scheduled or previous manual run is still in progress. Wait for it to complete before triggering another. You can poll the current run's status:

```bash
curl http://localhost:3000/evaluate/<run-id>
```

See the [API reference](/roombarr/reference/api/#post-evaluate) for details.

## Old run ID returns 404

Roombarr keeps only the last **10 evaluation runs** in memory. Older runs are evicted automatically and will return `404 Not Found`. For persistent history, check the audit logs stored in the SQLite database under `/config`.

## Schedule fires at the wrong time

The cron expression evaluates in the timezone set by the `TZ` environment variable. If `TZ` is not set, it defaults to **UTC**.

```yaml title="docker-compose.yml"
environment:
  - TZ=America/New_York
```

Make sure:
- `TZ` is set in your `docker-compose.yml` or container environment
- The value is a valid [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (e.g., `America/New_York`, not `EST`)
- You've restarted the container after changing the timezone

See [Environment Variables](/roombarr/reference/environment-variables/) for all available settings.

## Dry-run confusion

Roombarr defaults to `dry_run: true`, which means it evaluates rules and logs what it *would* do — but never actually deletes or unmonitors anything. This is by design.

If your evaluation results show matched items but nothing is happening:

1. Check your config — is `dry_run` explicitly set to `false`?
   ```yaml
   dry_run: false # Required for live execution
   ```

2. Check the evaluation response — every result item includes a `dry_run` field:
   ```json
   { "resolved_action": "delete", "dry_run": true, "execution_status": "skipped" }
   ```
   If `dry_run` is `true` and `execution_status` is `"skipped"`, Roombarr is working correctly — it's just not executing actions yet.

See [Configuration Overview > dry_run](/roombarr/configuration/overview/#dry_run) for details.

## Common YAML mistakes

YAML is whitespace-sensitive, and a few common mistakes can cause confusing errors:

### Indentation

YAML uses spaces, not tabs. Every level of nesting must be indented consistently. The `children` array in conditions is a common trouble spot:

```yaml
# ✅ Correct
conditions:
  operator: AND
  children:
    - field: radarr.added
      operator: older_than
      value: 1y

# ❌ Wrong — mixed indentation
conditions:
  operator: AND
  children:
  - field: radarr.added
    operator: older_than
      value: 1y
```

### Missing `children` key

The top-level `conditions` must always be a condition group with `operator` and `children`. Forgetting `children` is a common mistake:

```yaml
# ✅ Correct
conditions:
  operator: AND
  children:
    - field: radarr.monitored
      operator: equals
      value: false

# ❌ Wrong — no children key
conditions:
  operator: AND
  - field: radarr.monitored
    operator: equals
    value: false
```

### Duration units

`m` means **months**, not minutes. Use `min` for minutes. See [Operators > Duration syntax](/roombarr/reference/operators/#duration-syntax) for the full unit reference.

### Quoting strings

Most string values don't need quotes in YAML. But values that look like numbers or booleans do:

```yaml
# These are fine without quotes
- field: radarr.status
  operator: equals
  value: released

# Cron expressions should be quoted (contains spaces and special chars)
schedule: "0 3 * * *"
```

## Connection errors to services

If Roombarr can't reach Radarr, Sonarr, Jellyfin, or Jellyseerr, you'll see connection errors in the logs. Common causes:

### Wrong `base_url`

- **Docker Compose on the same network** — Use the Docker service name, not `localhost`:
  ```yaml
  # ✅ Correct — uses the Docker service name
  base_url: http://radarr:7878

  # ❌ Wrong — localhost refers to Roombarr's own container
  base_url: http://localhost:7878
  ```

- **Different Docker network** — If Roombarr and your services are on different Docker networks, they can't reach each other by service name. Either put them on the same network or use the host IP.

- **Host networking or external services** — Use the actual IP or hostname of the machine running the service.

### Bad API key

Double-check that you've copied the correct API key. In Radarr and Sonarr, find it under **Settings → General → API Key**. In Jellyfin, generate one under **Dashboard → API Keys**. Jellyseerr's API key is in **Settings → General**.

A bad API key typically results in a `401 Unauthorized` error in the logs.

### Trailing slashes

Don't include a trailing slash in your `base_url`:

```yaml
# ✅ Correct
base_url: http://radarr:7878

# ❌ Wrong
base_url: http://radarr:7878/
```

## Still stuck?

If none of the above helps:

1. Check the [GitHub Issues](https://github.com/roombarr/roombarr/issues) for similar problems
2. Open a new issue with your sanitized config (remove API keys), container logs, and evaluation output

## Related pages

- [Configuration Overview](/roombarr/configuration/overview/) — Config file structure and validation
- [Docker deployment](/roombarr/deployment/docker/) — Networking, volumes, and connectivity testing
- [API](/roombarr/reference/api/) — HTTP endpoints for triggering and polling evaluations
- [How It Works](/roombarr/how-it-works/) — The evaluation lifecycle for debugging flow
- [Config Recipes](/roombarr/recipes/) — Complete working configs to compare against
- [Getting Started](/roombarr/getting-started/) — Fresh-start guide if you need to reset
