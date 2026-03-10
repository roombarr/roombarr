<h1 align="center">
  <br>
  <img src="website/src/assets/logo-icon.svg" alt="Roombarr" width="200">
  <br>
  <br>
  Roombarr
  <br>
</h1>

<h4 align="center">A rule-based media cleanup engine for the <a href="https://wiki.servarr.com">*arr stack</a>.</h4>

<p align="center">
  <a href="https://github.com/roombarr/roombarr/blob/main/LICENSE"><img src="https://img.shields.io/github/license/roombarr/roombarr" alt="License"></a>
  <a href="https://github.com/roombarr/roombarr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/roombarr/roombarr/ci.yml?branch=main&label=ci" alt="CI"></a>
  <a href="https://github.com/roombarr/roombarr/releases/latest"><img src="https://img.shields.io/github/v/release/roombarr/roombarr" alt="GitHub Release"></a>
</p>

<p align="center">
  <a href="https://roombarr.github.io/roombarr/getting-started/">Getting Started</a> •
  <a href="https://roombarr.github.io/roombarr/configuration/">Configuration</a> •
  <a href="https://roombarr.github.io/roombarr/recipes/">Recipes</a> •
  <a href="https://roombarr.github.io/roombarr/api/">API</a> •
  <a href="https://roombarr.github.io/roombarr/reference/">Reference</a>
</p>

> **🚨 Early Development (v0.x)** — Breaking changes may occur between minor versions. Pin your Docker image to a specific version tag (e.g., `ghcr.io/roombarr/roombarr:v0.1.1`) instead of using `:latest` to avoid unexpected behavior. All breaking changes are documented in the [changelog](https://github.com/roombarr/roombarr/releases).

## Features

- **Declarative YAML rules** with composable AND/OR condition trees
- **Cross-service intelligence** — combine Radarr/Sonarr metadata with Jellyfin watch history and Jellyseerr request data in a single rule
- **Temporal state tracking** — conditions like "deleted 30 days after leaving all import lists" that look back through evaluation history
- **Conflict resolution** — when multiple rules match, the least destructive action always wins
- **Lazy data fetching** — only queries services that are actually referenced by your rules
- **Scheduled and on-demand** — cron-based automatic runs plus an HTTP API to trigger evaluations manually
- **Audit logging** — daily-rotated JSONL logs of every action decision
- **Docker-first** — designed to run alongside your existing \*arr stack

## Documentation

Full documentation is available at **[roombarr.github.io/roombarr](https://roombarr.github.io/roombarr/)** — including configuration reference, recipes, API docs, and the complete field/operator reference.

## Quick Start

Create a `roombarr.yml` config file:

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

Run with Docker Compose (or any container platform — same image and env vars apply):

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

```bash
docker compose up -d
curl http://localhost:3000/health
# → { "status": "ok", "version": "x.y.z" }
```
