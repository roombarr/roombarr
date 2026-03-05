---
title: "feat: Replace custom duration parsing with parse-duration"
type: feat
status: pending
date: 2026-03-04
---

# feat: Replace custom duration parsing with `parse-duration`

## Overview

Roombarr currently maintains a custom `duration.ts` module that supports 4 duration units (`d`, `w`, `m`, `y`) via regex. The [`parse-duration`](https://github.com/jkroso/parse-duration) npm package (395k weekly downloads, 0 deps, MIT, built-in TS types) provides far richer duration parsing out of the box — compound expressions, multiple units, locales, etc. Adopting it reduces maintenance surface and gives users more expressive duration syntax for free.

## Problem Statement / Motivation

The custom duration module is a thin, bespoke implementation solving a generic problem that the open source community has already addressed at scale. Maintaining it means owning validation logic, unit tests, and documentation for behavior that `parse-duration` handles better. The custom module only supports 4 units — `parse-duration` supports nanoseconds through years, compound expressions (`1h 20m`), and more.

## Breaking Change: `m` = minutes, not months

In `parse-duration`, `m` means **minutes** and `mo` means **months**. This is a breaking change for existing Roombarr configs where `6m` currently means "6 months". After this change, `6m` = 6 minutes. Users must update to `6mo` for months.

This is intentional — we fully adopt `parse-duration` syntax and consider this a breaking change.

## Proposed Solution

Replace the custom duration module entirely with `parse-duration`. No wrapper — use the library directly at call sites.

## Implementation Steps

### 1. Install `parse-duration`
```
bun add parse-duration
```

### 2. Delete custom duration module
- Delete `src/shared/duration.ts`
- Delete `src/shared/duration.test.ts`

### 3. Update `src/rules/operators.ts`
- Replace import of custom `parseDuration`/`subtractDuration` with `parse-duration`
- `parse-duration` returns milliseconds, so `older_than`/`newer_than` become:
  ```ts
  const ms = parse(value as string);
  if (ms === null) throw new Error(`Invalid duration: "${value}"`);
  const threshold = new Date(Date.now() - ms);
  return new Date(field as string) < threshold;  // older_than
  ```
- This is simpler — no intermediate `ParsedDuration` object or `subtractDuration` helper

### 4. Update `src/config/config.schema.ts`
- Replace `isValidDuration` import with `parse-duration`
- Validation becomes: `parse(value) === null` → invalid
- Update error message to remove the old format hint `(d/w/m/y)` and instead direct users to `parse-duration` docs

### 5. Update `src/rules/operators.test.ts`
- Duration strings like `6m` (meaning months) → `6mo`
- `1y` stays valid (parse-duration supports `y`)
- `4w` stays valid
- `30d` stays valid

### 6. Update `src/config/config.service.test.ts`
- Update any duration strings in test fixtures that use `m` for months → `mo`
- Update invalid duration error message assertions to match new format

### 7. Update `README.md`
- Replace the duration format table with a brief note that durations are powered by `parse-duration`
- Link users to parse-duration's README for the full syntax reference
- Update all example YAML snippets: `6m` → `6mo`, `3m` → `3mo` (months cases)
- Keep `30d`, `2w`, `1y`, `90d`, `180d` as-is (these are unchanged)

## Files Affected

- `package.json` — add `parse-duration` dependency
- `src/shared/duration.ts` — **delete**
- `src/shared/duration.test.ts` — **delete**
- `src/rules/operators.ts` — update imports and operator logic
- `src/config/config.schema.ts` — update validation logic
- `src/rules/operators.test.ts` — update duration strings in tests
- `src/config/config.service.test.ts` — update duration strings and error assertions
- `README.md` — update duration documentation and examples
