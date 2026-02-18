---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, typescript, data-integrity]
dependencies: ["001"]
---

# Guard against undefined winningRule in audit emission

## Problem Statement

In `rules.service.ts`, when emitting an audit event, `matches.find(m => m.action === resolvedAction)` could theoretically return `undefined`. The code falls back to empty strings via `??` chains, which would silently produce corrupt audit records with blank `rule` and `reasoning` fields.

```typescript
const winningRule = matches.find(m => m.action === resolvedAction);
const reasoning = reasoningCache.get(winningRule?.rule_name ?? '') ?? '';

this.auditService.logAction(
  item,
  resolvedAction,
  winningRule?.rule_name ?? '',  // silent empty string
  // ...
```

## Findings

- **TypeScript Reviewer**: "Silent empty-string fallbacks produce corrupt audit records with no indication anything went wrong. If the case is impossible, assert it."

## Proposed Solutions

### Option A: Explicit guard with error log (Recommended)

```typescript
const winningRule = matches.find(m => m.action === resolvedAction);
if (!winningRule) {
  this.logger.error(`No matching rule found for resolved action ${resolvedAction}`);
  continue;
}
const reasoning = reasoningCache.get(winningRule.rule_name) ?? '';
```

**Pros:** Eliminates `??` chains, makes "impossible" case explicit, logs clearly
**Cons:** None
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A. Note: this will be cleaner after TODO 001 (options object refactor).

## Technical Details

- **Affected files:** `src/rules/rules.service.ts` (lines 74-86)

## Acceptance Criteria

- [ ] No silent empty-string fallback for `winningRule`
- [ ] Explicit guard or assertion for `undefined` case
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | TypeScript reviewer finding |

## Resources

- PR branch: `logging`
