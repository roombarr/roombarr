---
status: pending
priority: p2
issue_id: "002"
tags: [code-review, security]
dependencies: []
---

# Fix path traversal startsWith prefix-overlap edge case

## Problem Statement

The path validation in `AuditService.onModuleInit()` uses `startsWith` without a trailing separator, which allows a directory like `/data-evil` to pass the `/data` check.

```typescript
// Current — vulnerable to prefix overlap
if (!resolvedDir.startsWith(dataDir)) {
  throw new Error(...);
}
```

If `dataDir` is `/data` and `resolvedDir` is `/data-evil/logs`, `startsWith('/data')` returns `true`.

## Findings

- **Security Sentinel**: "Path traversal `startsWith` prefix-overlap edge case. Fix: append `/` to prefix." (Low severity)
- **Architecture Strategist**: "Harden path prefix check with trailing separator"
- **Pattern Recognition Specialist**: Confirmed the same finding

## Proposed Solutions

### Option A: Append trailing separator (Recommended)

```typescript
const dataDirWithSep = dataDir.endsWith('/') ? dataDir : `${dataDir}/`;
if (!resolvedDir.startsWith(dataDirWithSep) && resolvedDir !== dataDir) {
  throw new Error(...);
}
```

**Pros:** Simple, correct, minimal change
**Cons:** None
**Effort:** Small
**Risk:** Low

### Option B: Use path.relative() check

```typescript
const relative = path.relative(dataDir, resolvedDir);
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(...);
}
```

**Pros:** More idiomatic Node.js path handling
**Cons:** Slightly less obvious what it does
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A — simplest fix with clearest intent.

## Technical Details

- **Affected files:** `src/audit/audit.service.ts` (onModuleInit)
- **Affected tests:** `src/audit/audit.service.test.ts` (path validation tests)

## Acceptance Criteria

- [ ] `/data-evil/logs` is correctly rejected when data dir is `/data`
- [ ] `/data/logs` still passes
- [ ] `/data` itself still passes (edge case: log dir = data dir)
- [ ] Test added for prefix-overlap case
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | Multiple agents flagged same issue |

## Resources

- PR branch: `logging`
- Commit: 38fd928
