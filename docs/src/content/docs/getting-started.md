---
title: Getting Started
description: Install and run Roombarr in under five minutes.
---

## Prerequisites

- **Docker** installed and running
- At least one **Radarr or Sonarr instance** with API access enabled
- The **API key** for that instance (found in Settings → General → API Key)

## Quick start

### Create your config

Create a `roombarr.yml` config file. Roombarr reads its config from `/config/roombarr.yml` inside the container. How you get the file there depends on your platform — the Docker Compose example below uses a bind mount.

```yaml
dry_run: true

services:
  radarr:
    base_url: http://radarr:7878
    api_key: your-radarr-api-key

schedule: "0 3 * * *"

rules:
  - name: Delete old unmonitored movies
    target: radarr
    action: delete
    conditions:
      operator: AND
      children:
        - field: radarr.added
          operator: older_than
          value: 1y
        - field: radarr.monitored
          operator: equals
          value: false
```

### Start the container

Here's a Docker Compose example. If you use another container platform (Unraid, TrueNAS, Portainer), the same image and settings apply — consult your platform's docs for container configuration.

```yaml
services:
  roombarr:
    image: ghcr.io/roombarr/roombarr:latest
    container_name: roombarr
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./config:/config
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/New_York
```

- **`image`** — Official image from GitHub Container Registry.
- **`ports`** — Exposes the HTTP API on port 3000 for health checks and manual evaluations.
- **`volumes`** — Maps a host directory to `/config` inside the container. Roombarr reads `roombarr.yml`, stores its SQLite database, and writes audit logs here.
- **`PUID` / `PGID`** — User and group ID inside the container. Match to your host user (`id` command) to avoid permission issues.
- **`TZ`** — Timezone for cron scheduling and log timestamps. Use [IANA timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

:::caution
Roombarr is pre-1.0 — pin to a specific version tag in production (e.g., `:v0.2.0`) instead of `:latest`. Breaking changes may occur between minor versions.
:::

Start the container:

```bash
docker compose up -d
```

### Verify and test

Check that Roombarr is healthy:

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok", "version": "x.y.z" }
```

:::tip
If the container exits immediately, check the logs for configuration errors:

```bash
docker compose logs roombarr
```

:::

With `dry_run: true`, trigger a manual evaluation to see what your rules would do:

```bash
curl -X POST http://localhost:3000/evaluate
```

You'll receive a `202 Accepted` response with a run ID:

```json
{ "run_id": "550e8400-e29b-41d4-a716-446655440000", "status": "running" }
```

Poll for results using the run ID:

```bash
curl http://localhost:3000/evaluate/550e8400-e29b-41d4-a716-446655440000
```

```json
{
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "started_at": "2026-02-17T03:00:00.000Z",
  "completed_at": "2026-02-17T03:00:12.000Z",
  "dry_run": true,
  "summary": {
    "items_evaluated": 142,
    "items_matched": 7,
    "actions": { "delete": 7, "unmonitor": 0, "keep": 0 },
    "rules_skipped_missing_data": 0
  },
  "results": [...]
}
```

This tells you 142 items were evaluated, 7 matched and would be deleted. Because `dry_run` is `true`, nothing was actually removed. See the [API reference](/roombarr/api/) for the full response shape.

:::caution
Only set `dry_run: false` after reviewing results and confirming your rules match what you expect. There is no undo for deleted media.
:::
