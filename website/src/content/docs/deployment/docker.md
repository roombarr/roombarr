---
title: Docker
description: In-depth Docker guide covering image tags, networking, updating, volumes, and security hardening.
---

This guide covers everything you need to run Roombarr in Docker beyond the basics. If you haven't set up Roombarr yet, start with the [Getting Started](/roombarr/getting-started/) guide — it takes about five minutes.

## Image details

Roombarr is published to the GitHub Container Registry:

```
ghcr.io/roombarr/roombarr
```

The image is built on the [LinuxServer.io](https://www.linuxserver.io/) Alpine 3.21 base image and supports the following architectures:

| Architecture | Platform |
|---|---|
| amd64 | Standard x86_64 servers and desktops |
| arm64 | Raspberry Pi 4/5, Apple Silicon, AWS Graviton |

## Image tags

| Tag | Description |
|---|---|
| `latest` | Latest stable release. Updates automatically on every release. |
| `v0.x.x` | Pinned version. Use this in production to control when you upgrade. |

:::caution
Roombarr is in early development (v0.x). Breaking changes may occur between minor versions. Always pin to a specific version tag in production instead of using `:latest`.
:::

## Docker Compose (recommended)

Below is a full annotated Compose file. Adjust the volume paths and environment variables to match your setup.

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

Place your `roombarr.yml` config file inside the `./config` directory before starting the container. See [Getting Started](/roombarr/getting-started/) for a starter config. Set [`TZ`](/roombarr/reference/environment-variables/#tz) to your local timezone so cron schedules fire at the right time — see [Environment Variables](/roombarr/reference/environment-variables/) for the full list.

Start the stack:

```bash
docker compose up -d
```

## Docker run alternative

If you prefer a one-liner:

```bash
docker run -d \
  --name roombarr \
  --restart unless-stopped \
  -p 3000:3000 \
  -v ./config:/config \
  -e PUID=1000 \
  -e PGID=1000 \
  -e TZ=America/New_York \
  ghcr.io/roombarr/roombarr:latest
```

## Volumes and persistence

All persistent data lives under `/config` inside the container.

| Container path | Purpose |
|---|---|
| `/config/roombarr.yml` | Your YAML configuration file |
| `/config/roombarr.sqlite` | SQLite database (evaluation history, run metadata) |
| `/config/logs/` | Audit logs |

:::tip
Back up the entire `/config` volume before upgrading Roombarr. The database and config file are the only state you need to preserve.
:::

## Networking

Roombarr needs HTTP access to your arr services (Radarr, Sonarr, Jellyfin, Jellyseerr). How you configure that depends on your Docker network setup.

### Shared Docker network (recommended)

If Roombarr and your arr services are on the same Docker network, use the **service name** as the hostname in your `roombarr.yml`:

```yaml
services:
  radarr:
    base_url: http://radarr:7878
  sonarr:
    base_url: http://sonarr:8989
```

Docker's built-in DNS resolves these names to the correct container IPs automatically.

To put all your services on the same network, either define them in the same `docker-compose.yml` or create an external network:

```bash
docker network create arr-network
```

Then add the network to each service's Compose file:

```yaml
services:
  roombarr:
    # ... other config
    networks:
      - arr-network

networks:
  arr-network:
    external: true
```

### Host IP fallback

If your arr services aren't on the same Docker network (e.g., they run on a different host or in a different Compose stack without a shared network), use the host machine's IP address:

```yaml
services:
  radarr:
    base_url: http://192.168.1.100:7878
```

### Verifying connectivity

From inside the Roombarr container, test that you can reach your arr services:

```bash
docker exec roombarr wget -qO- 'http://radarr:7878/api/v3/system/status?apikey=YOUR_KEY'

# Or with curl, if available in your container:
docker exec roombarr curl -s 'http://radarr:7878/api/v3/system/status?apikey=YOUR_KEY'
```

If the command returns JSON, connectivity is working. If it hangs or errors, check your network configuration. See [Troubleshooting](/roombarr/troubleshooting/) for common connectivity issues.

## Updating

Pull the latest image and recreate the container:

```bash
docker compose pull roombarr
docker compose up -d roombarr
```

Verify the update succeeded:

```bash
curl http://localhost:3000/health
```

You should see the new version in the response:

```json
{ "status": "ok", "version": "x.y.z" }
```

:::note
Roombarr runs database migrations automatically on startup. There are no manual migration steps between versions.
:::

## Security hardening

For production deployments, consider adding these security options to your Compose file:

```yaml
services:
  roombarr:
    image: ghcr.io/roombarr/roombarr:latest
    container_name: roombarr
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    ports:
      - "3000:3000"
    volumes:
      - ./config:/config
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/New_York
```

What each option does:

- **`read_only: true`** — Makes the container filesystem read-only. Roombarr only writes to `/config` (mounted as a volume) and `/tmp`.
- **`tmpfs: /tmp`** — Provides a writable in-memory filesystem for temporary files since the root filesystem is read-only.
- **`no-new-privileges`** — Prevents processes inside the container from gaining additional privileges.
- **`cap_drop: ALL`** — Drops all Linux capabilities. Roombarr doesn't need any special kernel capabilities.

## Next steps

- **Configure your rules** — Set up conditions and actions → [Configuration > Overview](/roombarr/configuration/overview/)
- **TrueNAS Scale** — Platform-specific setup for TrueNAS Scale 24.10+ → [Deployment > TrueNAS Scale](/roombarr/deployment/truenas/)
- **Troubleshoot issues** — Common problems and solutions → [Troubleshooting](/roombarr/troubleshooting/)
