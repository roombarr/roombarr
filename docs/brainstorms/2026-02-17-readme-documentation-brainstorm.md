# Brainstorm: User-Facing README Documentation

**Date:** 2026-02-17
**Status:** Approved

## What We're Building

A single, comprehensive `README.md` that serves as the complete user-facing documentation for Roombarr. The project currently has no user-facing docs — only internal design documents and an example config file. For an open source utility, this is the #1 adoption blocker.

The README targets **self-hosters already running the \*arr stack** (Sonarr, Radarr, Jellyfin, Jellyseerr). It assumes familiarity with Docker Compose, YAML configuration, and API keys. No need to explain what these services are.

## Why This Approach

**Single README over multi-file docs or a docs site:**

- Roombarr is a focused utility, not a platform — one file covers everything without fragmentation
- Easier to maintain as the project evolves (one file to update, not a docs site to deploy)
- Users can Ctrl+F to find what they need
- Appropriate for the project's current maturity (v1, dry-run only)
- Can always split into a docs site later if scope demands it

**Conversational but concise tone:**

- Mirrors the \*arr ecosystem documentation style (Overseerr, Jellyseerr)
- Briefly explains "why" alongside "how" without being verbose
- Heavy use of realistic config examples — let the YAML speak

## Key Decisions

### Structure (in order)

1. **Project title + one-liner** — What Roombarr is in a single sentence
2. **Dry-run callout** — Prominent notice that v1 is non-destructive, framed positively ("safe to experiment with")
3. **Features overview** — Bullet list of capabilities
4. **Quick Start** — Docker Compose setup in ~5 steps
5. **Configuration reference** — Full breakdown of `roombarr.yml` sections (services, schedule, performance, audit)
6. **Writing Rules** — Core of the README. Covers targets, actions, conditions, operators, field paths, nesting, and conflict resolution with real-world examples
7. **Available Fields** — Tables of all condition fields organized by service (Radarr, Sonarr, Jellyfin, Jellyseerr, State)
8. **API** — The two HTTP endpoints (`GET /health`, `POST /evaluate`, `GET /evaluate/:runId`)
9. **Environment Variables** — Table of overrides
10. **Development** — Brief section for contributors (bun install, dev server, tests)

### Content Priorities

- **Rule writing gets the most space** — it's the core UX and the part users will reference most
- **Lead with Docker Compose** — that's the target deployment method
- **Include 3-4 realistic rule examples** that demonstrate different patterns (date-based cleanup, watched status, import list tracking, combined conditions)
- **Group fields by service** in tables for easy scanning
- **Field tables should include type info** (date, number, boolean, array, string) so users know which operators apply

### Tone

- Conversational but concise — explain briefly, then show config
- No jargon beyond what the \*arr community already uses
- Honest about v1 limitations (dry-run only) without being apologetic

### v1 Status Handling

- Prominent callout near the top of the README
- Frame positively: "safe to try out, see what would happen without any risk"
- Mention that live execution is planned for a future release

## Open Questions

None — all key decisions resolved during brainstorming.

## Out of Scope

- Docs site or multi-page documentation (can revisit when project grows)
- Logo or branding assets
- CHANGELOG or CONTRIBUTING.md (separate efforts)
- Badges beyond basic project metadata
