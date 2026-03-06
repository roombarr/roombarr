---
title: Environment Variables
description: Docker environment variables including CONFIG_PATH, TZ, and more.
---

Roombarr is configured primarily through its [YAML config file](/roombarr/configuration/overview/), but a handful of environment variables control the runtime environment itself — things like file paths, timezone, and container permissions. You set these in the `environment` block of your `docker-compose.yml`.

## Quick Reference

| Variable | Default | Description |
|---|---|---|
| `PUID` | `1000` | User ID for file ownership inside the container |
| `PGID` | `1000` | Group ID for file ownership inside the container |
| `TZ` | `UTC` | Timezone for cron scheduling and log timestamps |
| `CONFIG_PATH` | `/config/roombarr.yml` | Path to the YAML config file |
| `DB_PATH` | `/config/roombarr.sqlite` | Path to the SQLite database file |
| `PORT` | `3000` | HTTP port the API listens on |
| `NODE_ENV` | `production` | Node environment (`production` or `development`) |

## Full Example

Here's a `docker-compose.yml` snippet with every variable set explicitly:

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
      - CONFIG_PATH=/config/roombarr.yml
      - DB_PATH=/config/roombarr.sqlite
      - PORT=3000
      - NODE_ENV=production
```

:::tip
Most users only need to set `PUID`, `PGID`, and `TZ`. The remaining variables have sensible defaults that work out of the box with the standard `/config` volume mount.
:::

## Variable Details

### `PUID`

| | |
|---|---|
| **Default** | `1000` |
| **Example** | `PUID=1000` |

Sets the user ID that Roombarr runs as inside the container. This comes from the [LinuxServer.io base image](https://docs.linuxserver.io/general/understanding-puid-and-pgid/) and ensures files written to the `/config` volume (database, audit logs) are owned by the correct user on your host system.

Run `id` on your host to find your user ID, then set `PUID` to match.

### `PGID`

| | |
|---|---|
| **Default** | `1000` |
| **Example** | `PGID=1000` |

Sets the group ID that Roombarr runs as inside the container. Works the same way as `PUID` — match it to your host group ID to avoid file permission issues.

### `TZ`

| | |
|---|---|
| **Default** | `UTC` |
| **Example** | `TZ=America/New_York` |

Controls the timezone used by the cron scheduler and log timestamps. Set this to your local timezone so that schedule expressions like `0 3 * * *` fire at 3 AM *your* time, not UTC.

Accepts any valid [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (e.g., `Europe/London`, `Asia/Tokyo`, `America/Chicago`).

:::caution
If you leave `TZ` unset, schedules run in UTC. A rule scheduled for `0 3 * * *` would fire at 3 AM UTC, which may be the middle of the afternoon in your timezone.
:::

### `CONFIG_PATH`

| | |
|---|---|
| **Default** | `/config/roombarr.yml` |
| **Example** | `CONFIG_PATH=/config/roombarr.yml` |

The absolute path inside the container where Roombarr looks for its YAML config file. You only need to change this if you've mounted your config file at a non-standard location.

Roombarr resolves the config path in this order:

1. The path set by `CONFIG_PATH`
2. `/config/roombarr.yml` (fallback default)

If the file is missing or invalid at the resolved path, Roombarr refuses to start and prints a clear error message. See [Configuration Overview](/roombarr/configuration/overview/) for the full config file reference.

### `DB_PATH`

| | |
|---|---|
| **Default** | `/config/roombarr.sqlite` |
| **Example** | `DB_PATH=/config/roombarr.sqlite` |

The absolute path inside the container where Roombarr stores its SQLite database. The database holds evaluation history, run metadata, and internal state.

:::tip
Keep this inside your `/config` volume so the database persists across container restarts and upgrades. If you lose this file, Roombarr will create a fresh database on next startup — but you'll lose evaluation history.
:::

### `PORT`

| | |
|---|---|
| **Default** | `3000` |
| **Example** | `PORT=8080` |

The port Roombarr's HTTP API listens on inside the container. If you change this, update your `ports` mapping and healthcheck accordingly:

```yaml
services:
  roombarr:
    environment:
      - PORT=8080
    ports:
      - "8080:8080"
```

### `NODE_ENV`

| | |
|---|---|
| **Default** | `production` |
| **Example** | `NODE_ENV=production` |

Controls the runtime environment. In `production` mode, Roombarr uses structured JSON logging at the `info` level. In `development` mode, it switches to pretty-printed `debug`-level logging.

:::caution
This is set automatically in the Docker image. You should not need to change it unless you're developing Roombarr itself.
:::

## Related pages

- [Configuration Overview](/roombarr/configuration/overview/) — Config file structure and all top-level keys
- [Docker deployment](/roombarr/deployment/docker/) — Full Docker guide including volumes and networking
