---
title: Roombarr
description: Rule-based media cleanup engine for the *arr stack.
template: splash
hero:
  image:
    alt: Roombarr logo
    file: ../../assets/logo-transparent.png
  tagline: Declarative rules for cleaning up your Radarr and Sonarr libraries.
  actions:
    - text: Get Started
      link: /roombarr/getting-started/
      icon: right-arrow
      variant: primary
    - text: View on GitHub
      link: https://github.com/roombarr/roombarr
      icon: external
      variant: minimal
---

Your media library only grows. New movies get requested, seasons pile up, and nobody ever cleans house. Roombarr is the quiet, automatic housekeeper for your *arr stack — it watches your libraries, applies rules you define, and removes what no longer belongs. You set the policy once, and it handles the rest.

## Write Rules, Not Scripts

Instead of hacking together cron jobs and shell scripts, you describe what should happen in plain YAML:

```yaml
- name: Delete fully watched old movies
  target: radarr
  action: delete
  conditions:
    operator: AND
    children:
      - field: jellyfin.watched_by_all
        operator: equals
        value: true
      - field: radarr.added
        operator: older_than
        value: 6m
```

This single rule combines Radarr metadata with Jellyfin watch history to delete movies that everyone has watched and that have been in your library for over six months. No scripting required.

## Built for the *arr Stack

- **Cross-service intelligence** — combine data from Radarr, Sonarr, Jellyfin, and Jellyseerr in a single rule. One condition checks Radarr, the next checks Jellyfin — Roombarr stitches it together.
- **Declarative YAML rules** — composable AND/OR condition trees that read like plain English. No scripting, no callbacks, no imperative logic.
- **Safe by default** — dry-run mode is on out of the box. When rules conflict, the least destructive action always wins. You have to opt in to live execution.
- **Scheduled or on-demand** — set a cron schedule for automatic runs, or trigger evaluations manually through the HTTP API. Your call.
- **Lazy data fetching** — Roombarr only queries the services your rules actually reference. No Jellyfin conditions? Jellyfin is never called.
- **Audit everything** — every action decision is logged to daily-rotated JSONL files. Know exactly what happened and why.

## How It Works

1. **Connect your services** — point Roombarr at your Radarr, Sonarr, Jellyfin, and Jellyseerr instances.
2. **Write your rules** — describe what to delete, unmonitor, or keep using declarative YAML conditions.
3. **Set a schedule** — pick a cron expression, or trigger runs manually through the API.
4. **Roombarr handles the rest** — it evaluates every item against your rules, resolves conflicts, and takes action (or logs what it would do in dry-run mode).

## Get Running in Minutes

```yaml
services:
  roombarr:
    image: ghcr.io/roombarr/roombarr:latest # pin to a version tag for production
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

Drop your `roombarr.yml` config into the `./config` directory and you're up.

> **Roombarr is in early development (v0.x).** Breaking changes may occur between minor versions. Pin your Docker image to a specific version tag (e.g., `ghcr.io/roombarr/roombarr:v0.1.1`) instead of using `:latest`.

Ready to take control of your media library? Check out the [Getting Started](/roombarr/getting-started/) guide, or browse the source on [GitHub](https://github.com/roombarr/roombarr). Contributions and feedback are always welcome.
