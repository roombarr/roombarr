---
status: pending
priority: p3
issue_id: "005"
tags: [code-review, simplicity, testability]
dependencies: []
---

# Extract buildReasoning to standalone pure function

## Problem Statement

`buildReasoning()` is a pure function with no dependencies on `AuditService` instance state. Keeping it as a method forces tests to use `Object.create(AuditService.prototype)` — a novel and fragile pattern — just to test a pure transformation.

## Findings

- **Code Simplicity Reviewer**: "buildReasoning on AuditService should be standalone function"
- **Pattern Recognition Specialist**: "Object.create test pattern (Medium) — novel, not seen elsewhere in codebase"

## Proposed Solutions

### Option A: Export as standalone function (Recommended)

Move `buildReasoning` (and its helper `formatConditionGroup`) to a separate file like `src/audit/reasoning.ts`.

```typescript
// src/audit/reasoning.ts
export function buildReasoning(conditions: ConditionGroup): string { ... }
```

Tests become straightforward imports with no `Object.create` hack.

**Pros:** Testable without service instantiation, clearer separation, eliminates Object.create hack
**Cons:** AuditService loses a method (but it's not using `this`)
**Effort:** Small
**Risk:** Low

### Option B: Make it a static method

```typescript
static buildReasoning(conditions: ConditionGroup): string { ... }
```

**Pros:** Minimal change, tests use `AuditService.buildReasoning()`
**Cons:** Still couples a pure function to a service class
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A — standalone function in its own file. Clean separation.

## Technical Details

- **Affected files:** `src/audit/audit.service.ts`, new `src/audit/reasoning.ts`, `src/audit/audit.service.test.ts`, `src/rules/rules.service.ts`

## Acceptance Criteria

- [ ] `buildReasoning` is a standalone exported function
- [ ] Tests import and call it directly (no Object.create)
- [ ] `AuditService` delegates to the function or it's called directly by `RulesService`
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | Testability improvement |

## Resources

- PR branch: `logging`
