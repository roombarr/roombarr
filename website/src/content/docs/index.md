---
title: Roombarr
description: Rule-based media cleanup engine for the *arr stack.
template: splash
hero:
  image:
    alt: Roombarr logo
    file: ../../assets/logo.svg
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

Your media library only grows. New movies get requested, seasons pile up, and nothing gets removed. Roombarr automatically applies rules you define to clean up Radarr and Sonarr libraries — removing, unmonitoring, or protecting items on a schedule. You set the policy once, and it handles the rest.

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
        value: 6mo
```

This single rule combines Radarr metadata with Jellyfin watch history to delete movies that everyone has watched and that have been in your library for over six months. No scripting required.

Ready to take control of your media library? Head to the [Getting Started](/roombarr/getting-started/) guide to get up and running.
