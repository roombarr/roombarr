---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, typescript, runtime-safety]
dependencies: []
---

# Fix non-definite assertion on auditLogger

## Problem Statement

`auditLogger` uses the `!` non-definite assertion, meaning TypeScript trusts it will be assigned before use. But `logAction()` is public — if it's called before `onModuleInit()` completes (or if `onModuleInit()` throws during `initTransport()`), `this.auditLogger` is `undefined` and `this.auditLogger.info(entry)` throws an unhandled runtime error.

```typescript
private auditLogger!: pino.Logger;  // dangerous — undefined until onModuleInit
```

The `onModuleDestroy` method already guards against this (`if (!this.auditLogger) return`), proving the scenario was considered for teardown but not for the hot path.

## Findings

- **TypeScript Reviewer**: "Critical — Non-definite assignment assertion on auditLogger hides a real runtime risk"

## Proposed Solutions

### Option A: Initialize to no-op pino instance (Recommended)

```typescript
private auditLogger: pino.Logger = pino({ enabled: false });
```

**Pros:** Removes `!` entirely, calls before init are silently safe (no-op), clear intent
**Cons:** Requires pino import at class level (already imported)
**Effort:** Small
**Risk:** Low

### Option B: Add guard in logAction

```typescript
logAction(...) {
  if (!this.auditLogger) {
    this.logger.warn('Audit logger not initialized — skipping audit');
    return;
  }
  // ...
}
```

**Pros:** Explicit, logged warning
**Cons:** Still uses `!` assertion, guard is a band-aid
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A — eliminates the assertion entirely and is the cleanest approach.

## Technical Details

- **Affected files:** `src/audit/audit.service.ts` (line 18)

## Acceptance Criteria

- [ ] No `!` assertion on `auditLogger`
- [ ] Calling `logAction()` before `onModuleInit()` does not crash
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | TypeScript reviewer finding |

## Resources

- PR branch: `logging`
