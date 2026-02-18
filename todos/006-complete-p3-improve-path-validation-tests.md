---
status: pending
priority: p3
issue_id: "006"
tags: [code-review, testing]
dependencies: ["002"]
---

# Improve path validation tests to test actual service behavior

## Problem Statement

The current path validation tests in `audit.service.test.ts` test `node:path`'s `resolve().startsWith()` behavior directly, rather than testing the `AuditService`'s actual validation logic. If the service's validation approach changes, these tests would still pass.

```typescript
// Current — tests node:path, not the service
test('rejects log_directory outside data directory', () => {
  const logDir = '/tmp/evil-logs';
  const resolvedDir = resolve(logDir);
  const dataDir = resolve(process.env.DATA_PATH ?? '/data');
  expect(resolvedDir.startsWith(dataDir)).toBe(false);
});
```

## Findings

- **Pattern Recognition Specialist**: "Path validation tests test node:path not service (Low severity)"

## Proposed Solutions

### Option A: Test service instantiation with invalid config (Recommended)

Test that `AuditService.onModuleInit()` throws when given an out-of-bounds directory.

```typescript
test('rejects log_directory outside data directory', () => {
  const service = new AuditService(mockConfigWithLogDir('/tmp/evil-logs'));
  expect(() => service.onModuleInit()).toThrow(/must be within the data directory/);
});
```

**Pros:** Tests actual service behavior, catches regressions in validation logic
**Cons:** Requires mocking ConfigService
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A. This is blocked by TODO 002 (fix the path traversal bug first, then write proper tests).

## Technical Details

- **Affected files:** `src/audit/audit.service.test.ts`

## Acceptance Criteria

- [ ] Tests invoke `AuditService.onModuleInit()` with bad paths and assert throws
- [ ] Tests invoke with valid paths and assert no throw
- [ ] Prefix-overlap case (`/data-evil`) is covered
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | Test quality improvement |

## Resources

- PR branch: `logging`
- Depends on: TODO 002
