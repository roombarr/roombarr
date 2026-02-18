---
status: pending
priority: p3
issue_id: "004"
tags: [code-review, security, schema-validation]
dependencies: []
---

# Add upper bound to retention_days schema validation

## Problem Statement

The `retention_days` field in `auditSchema` has a `.min(1)` but no `.max()`, allowing arbitrarily large values that could cause unexpected disk usage or integer overflow in downstream date math.

```typescript
retention_days: z.number().int().min(1).default(90),
// No upper bound — user could set 999999999
```

## Findings

- **Security Sentinel**: "No upper bound on retention_days. Fix: add `.max(3650)`." (Low severity)

## Proposed Solutions

### Option A: Add .max(3650) (Recommended)

10 years is a reasonable maximum for log retention.

```typescript
retention_days: z.number().int().min(1).max(3650).default(90),
```

**Pros:** Simple, prevents unreasonable values, clear intent
**Cons:** Arbitrary cap, but 10 years is generous
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `src/config/config.schema.ts`

## Acceptance Criteria

- [ ] `retention_days` has `.max(3650)` in schema
- [ ] Config validation rejects values > 3650
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | Security hardening |

## Resources

- PR branch: `logging`
