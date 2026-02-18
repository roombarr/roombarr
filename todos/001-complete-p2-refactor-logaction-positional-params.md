---
status: pending
priority: p2
issue_id: "001"
tags: [code-review, architecture, readability]
dependencies: []
---

# Refactor logAction from 7 positional params to options object

## Problem Statement

`AuditService.logAction()` accepts 7 positional parameters, making call sites brittle and hard to read. This was flagged independently by Architecture Strategist, Code Simplicity Reviewer, and Pattern Recognition Specialist.

```typescript
// Current — positional params are unreadable at call sites
this.auditService.logAction(
  item,           // what is this?
  resolvedAction, // and this?
  winningRule?.rule_name ?? '',
  matchedRuleNames,
  reasoning,
  evaluationId,
  true,           // what does true mean?
);
```

## Findings

- **Architecture Strategist**: "7 positional params on logAction is a code smell — refactor to options object"
- **Code Simplicity Reviewer**: "7 positional params: readability problem"
- **Pattern Recognition Specialist**: "7 positional params (Medium severity)"
- The private `buildEntry()` method has the same problem, compounding the issue

## Proposed Solutions

### Option A: Options object (Recommended)

Create an interface for the options and pass a single object.

```typescript
interface LogActionOptions {
  item: UnifiedMedia;
  action: Action;
  winningRule: string;
  matchedRules: string[];
  reasoning: string;
  evaluationId: string;
  dryRun: boolean;
}

logAction(options: LogActionOptions): void { ... }
```

**Pros:** Self-documenting call sites, easy to extend, eliminates boolean trap
**Cons:** Slightly more verbose definition
**Effort:** Small
**Risk:** Low — internal API only

### Option B: Builder pattern

Chain methods to build the audit entry before logging.

**Pros:** Very readable
**Cons:** Over-engineered for internal use, adds complexity
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option A — options object. It's the standard pattern for functions with 3+ params.

## Technical Details

- **Affected files:** `src/audit/audit.service.ts`, `src/rules/rules.service.ts`
- **Components:** AuditService.logAction(), AuditService.buildEntry()

## Acceptance Criteria

- [ ] `logAction()` accepts a single options object
- [ ] `buildEntry()` similarly refactored
- [ ] Call site in `rules.service.ts` updated
- [ ] All 243 tests pass
- [ ] No `any` types introduced

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | Consensus finding across 3 agents |

## Resources

- PR branch: `logging`
- Commit: 38fd928
