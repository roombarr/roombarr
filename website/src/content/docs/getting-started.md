---
title: Getting Started
description: Install, configure, and run Roombarr via Docker.
---

By the end of this page, Roombarr will be running in Docker, connected to Radarr, and evaluating a sample rule in dry-run mode. The whole process takes about five minutes.

## Prerequisites

Before you begin, make sure you have:

- **Docker and Docker Compose** installed and running
- At least one **Radarr or Sonarr instance** with API access enabled
- The **API key** for that instance (found in Settings → General → API Key in Radarr/Sonarr)

## Create your config

Create a file at `./config/roombarr.yml` with the following content:

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

There are four top-level keys to understand:

- **[`dry_run`](/roombarr/configuration/overview/#dry_run)** — When `true`, Roombarr logs every action it *would* take without actually doing anything. This is on by default, and you should leave it on until you've reviewed your first evaluation results.
- **`services`** — Tells Roombarr how to reach your *arr instances. Replace `base_url` and `api_key` with your real values. If Roombarr and Radarr are on the same Docker network, the Docker service name (e.g., `http://radarr:7878`) works as the URL. See [Integrations](/roombarr/integrations/radarr/) for adding Sonarr, Jellyfin, and Jellyseerr.
- **`schedule`** — A standard cron expression. This example runs daily at 3 AM in whatever timezone you set via the [`TZ` environment variable](/roombarr/reference/environment-variables/#tz). See [Configuration](/roombarr/configuration/overview/) for full syntax options.
- **`rules`** — The heart of Roombarr. The example rule reads: "Delete any Radarr movie that was added more than a year ago *and* is no longer monitored." See [Rules](/roombarr/configuration/rules/) for the full rule syntax, available operators, and condition trees.

## Start the container

Add Roombarr to your `docker-compose.yml`:

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

A quick rundown of the key lines:

- **`image`** — Pulls the latest Roombarr image from the GitHub Container Registry. For production, pin to a specific version tag (see caution below).
- **`ports`** — Exposes the HTTP API on port 3000 for health checks, manual evaluations, and future dashboard access.
- **`volumes`** — Mounts `./config` into the container at `/config`. This is where Roombarr reads your `roombarr.yml` and stores its SQLite database and audit logs.
- **`PUID` / `PGID`** — Sets the user and group ID inside the container. Match these to your host user to avoid file permission issues.
- **`TZ`** — Controls the timezone for cron scheduling and log timestamps. Set this to your local timezone.

:::caution
Roombarr is pre-1.0 — pin to a version tag in production. See [Image tags](/roombarr/deployment/docker/#image-tags) for details.
:::

Start the container:

```bash
docker compose up -d
```

## Verify it's running

Check that Roombarr started successfully:

```bash
curl http://localhost:3000/health
```

You should see:

```json
{ "status": "ok", "version": "x.y.z" }
```

:::tip
If the container exits immediately, check the logs for configuration errors:

```bash
docker compose logs roombarr
```

See [Troubleshooting](/roombarr/troubleshooting/) for common issues.
:::

## Test your rules

With `dry_run: true`, Roombarr evaluates your rules and logs what it *would* do — without touching your media. Trigger a manual evaluation to see it in action:

```bash
curl -X POST http://localhost:3000/evaluate
```

You'll receive a `202 Accepted` response with a run ID:

```json
{ "run_id": "abc123", "status": "running" }
```

Poll for the results using that run ID:

```bash
curl http://localhost:3000/evaluate/abc123
```

Once the evaluation completes, you'll see a summary like this:

```json
{
  "run_id": "abc123",
  "status": "completed",
  "dry_run": true,
  "summary": {
    "items_evaluated": 142,
    "items_matched": 7,
    "actions": {
      "delete": 7,
      "unmonitor": 0,
      "keep": 0
    },
    "rules_skipped_missing_data": 0
  }
}
```

This tells you 142 items were evaluated, 7 matched your rules and would be deleted. Because `dry_run` is `true`, no media was actually removed. See [API](/roombarr/reference/api/) for the full response reference.

:::caution
Only set `dry_run: false` after reviewing the results and confirming your rules match what you expect. There is no undo for deleted media.
:::

## Next steps

- **Add more services** — Connect Sonarr, Jellyfin, and Jellyseerr for cross-service rules → [Integrations](/roombarr/integrations/radarr/)
- **Write more rules** — Combine conditions, use OR trees, and target different actions → [Configuration > Rules](/roombarr/configuration/rules/)
- **Explore available fields** — See every field you can use in conditions → [Reference > Fields](/roombarr/reference/fields/)
- **Go live** — When you're confident in your rules, set `dry_run: false` → [Configuration > Overview](/roombarr/configuration/overview/)
- **Learn the API** — Trigger evaluations, check health, and poll results programmatically → [Reference > API](/roombarr/reference/api/)
- **Docker deep dive** — Image tags, networking, updating, and security hardening → [Deployment > Docker](/roombarr/deployment/docker/)
- **TrueNAS Scale** — Platform-specific setup for TrueNAS Scale 24.10+ → [Deployment > TrueNAS Scale](/roombarr/deployment/truenas/)
