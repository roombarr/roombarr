---
title: TrueNAS Scale
description: Platform-specific guide for running Roombarr on TrueNAS Scale 24.10+ with Docker Compose.
---

TrueNAS Scale 24.10 (Electric Eel) and later runs Docker natively, replacing the older Kubernetes-based app system. This guide walks you through setting up Roombarr on TrueNAS Scale using Docker Compose.

:::note
This guide requires **TrueNAS Scale 24.10 or later**. Earlier versions use a Kubernetes-based app system with a different setup process.
:::

## Prerequisites

Before you begin, make sure you have:

- **TrueNAS Scale 24.10+** with Docker Compose enabled (Apps → Settings → Choose Docker Compose)
- A **dataset** for application data (or an existing `appdata` dataset)
- At least one **Radarr or Sonarr instance** with API access enabled
- **SSH access** or the TrueNAS Shell for running commands

## Create a dataset

Roombarr needs a persistent directory for its config file, database, and logs. Create a dedicated dataset in the TrueNAS UI:

1. Go to **Datasets**
2. Select your pool (e.g., `tank`)
3. Click **Add Dataset**
4. Name it `roombarr` under your appdata path (e.g., `tank/appdata/roombarr`)
5. Accept the default settings and click **Save**

Your dataset path will be something like `/mnt/tank/appdata/roombarr/`.

:::tip
If you already have an `appdata` dataset for your other apps, create `roombarr` as a child dataset to keep everything organized.
:::

## File permissions

TrueNAS Scale uses a dedicated `apps` user with **UID 568** and **GID 568** for containerized applications. Roombarr's `PUID` and `PGID` environment variables must match these values so the container can read and write to your dataset.

Set ownership on your dataset:

```bash
chown -R 568:568 /mnt/tank/appdata/roombarr
```

:::caution
Permission mismatches are the most common issue on TrueNAS. If Roombarr can't start or throws file permission errors, double-check that `PUID`, `PGID`, and the dataset ownership all use **568**.
:::

## Create your config file

Place your `roombarr.yml` in the dataset directory:

```bash
nano /mnt/tank/appdata/roombarr/roombarr.yml
```

See [Getting Started](/roombarr/getting-started/) for a starter config. The only difference on TrueNAS is how you reference your arr services — see [Networking](#networking) below.

## Docker Compose setup

Create a `docker-compose.yml` file for Roombarr. You can place it anywhere convenient, such as `/mnt/tank/appdata/roombarr/docker-compose.yml`:

```yaml
services:
  roombarr:
    image: ghcr.io/roombarr/roombarr:latest
    container_name: roombarr
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /mnt/tank/appdata/roombarr:/config
    environment:
      - PUID=568
      - PGID=568
      - TZ=America/New_York   # Controls cron schedule timing — see Environment Variables
```

:::caution
Roombarr is pre-1.0 — pin to a version tag in production. See [Image tags](/roombarr/deployment/docker/#image-tags) for details.
:::

:::note
Roombarr defaults to `dry_run: true`. Your rules will be evaluated and logged, but no actions will be executed until you explicitly set `dry_run: false` in your `roombarr.yml`. See [Configuration Overview > dry_run](/roombarr/configuration/overview/#dry_run) for details.
:::

Note the TrueNAS-specific values:

- **Volume path** uses the full dataset path (`/mnt/tank/appdata/roombarr`) instead of a relative path
- **`PUID=568` / `PGID=568`** matches the TrueNAS `apps` user
- **[`TZ`](/roombarr/reference/environment-variables/#tz)** controls cron schedule timing — set to your local timezone

Start the container via SSH or the TrueNAS Shell:

```bash
cd /mnt/tank/appdata/roombarr
docker compose up -d
```

## Networking

How you configure service URLs in `roombarr.yml` depends on where your arr services are running.

### Arr services in Docker (shared network)

If your arr services also run as Docker containers on the same TrueNAS system, put them on a shared Docker network so they can reach each other by service name. See the [Docker guide networking section](/roombarr/deployment/docker/#shared-docker-network-recommended) for detailed setup instructions.

```yaml
services:
  radarr:
    base_url: http://radarr:7878
  sonarr:
    base_url: http://sonarr:8989
```

### Arr services as TrueNAS apps or remote

If your arr services are running as native TrueNAS apps, on a different machine, or otherwise not on the same Docker network, use your TrueNAS system's IP address:

```yaml
services:
  radarr:
    base_url: http://192.168.1.100:7878
  sonarr:
    base_url: http://192.168.1.100:8989
```

Replace `192.168.1.100` with your actual TrueNAS IP. You can find it under **Network → Interfaces** in the TrueNAS UI.

## Verify and test

Check that Roombarr started successfully using your TrueNAS IP:

```bash
curl http://192.168.1.100:3000/health
```

You should see:

```json
{ "status": "ok", "version": "x.y.z" }
```

Trigger a manual evaluation to test your rules:

```bash
curl -X POST http://192.168.1.100:3000/evaluate
```

:::tip
If the container exits immediately, check the logs for configuration errors:

```bash
docker compose logs roombarr
```

See [Troubleshooting](/roombarr/troubleshooting/) for common issues.
:::

## Updating

Pull the latest image and recreate the container:

```bash
cd /mnt/tank/appdata/roombarr
docker compose pull roombarr
docker compose up -d roombarr
```

Verify the update:

```bash
curl http://192.168.1.100:3000/health
```

## Next steps

- **Getting started** — Quick-start guide and first rule walkthrough → [Getting Started](/roombarr/getting-started/)
- **Docker deep dive** — Image tags, security hardening, and more → [Deployment > Docker](/roombarr/deployment/docker/)
- **Configure your rules** — Set up conditions and actions → [Configuration > Overview](/roombarr/configuration/overview/)
