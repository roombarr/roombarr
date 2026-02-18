---
status: pending
priority: p3
issue_id: "003"
tags: [code-review, architecture, consistency]
dependencies: []
---

# Normalize Action type import source across audit files

## Problem Statement

The `Action` type is imported from different locations in the audit module:

- `audit.service.ts` imports `Action` from `../rules/types.js`
- `audit.types.ts` imports `Action` from `../config/config.schema.js`

Both resolve to the same type, but the inconsistency creates confusion about the canonical source.

## Findings

- **Architecture Strategist**: "Normalize Action import — audit module should not reach into rules/types"
- **Pattern Recognition Specialist**: "Inconsistent Action import (Low severity)"

## Proposed Solutions

### Option A: Import from config schema everywhere (Recommended)

`Action` is defined in `config/config.schema.ts` as part of the config contract. Both `audit.service.ts` and `audit.types.ts` should import from there.

**Pros:** Config schema is the canonical source; audit shouldn't depend on rules
**Cons:** None
**Effort:** Small
**Risk:** Low

### Option B: Re-export from a shared types module

Create a shared barrel export.

**Pros:** Single import path for all consumers
**Cons:** Adds a file for minimal benefit
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A — import from config schema consistently.

## Technical Details

- **Affected files:** `src/audit/audit.service.ts` (change import source)

## Acceptance Criteria

- [ ] Both audit files import `Action` from `../config/config.schema.js`
- [ ] No import of `Action` from `../rules/types.js` in audit module
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | Consistency finding |

## Resources

- PR branch: `logging`
