---
status: pending
priority: p3
issue_id: "009"
tags: [code-review, maintainability]
dependencies: []
---

# Deduplicate audit schema default values

## Problem Statement

The `auditSchema` in `config.schema.ts` specifies defaults in two places — on each field AND on the object-level `.default()`. If someone changes one but not the other, they silently diverge.

```typescript
const auditSchema = z
  .object({
    log_directory: z.string().min(1).default('/data/logs/'),    // default here
    retention_days: z.number().int().min(1).default(90),        // and here
  })
  .default({ log_directory: '/data/logs/', retention_days: 90 }); // duplicated here
```

## Findings

- **TypeScript Reviewer**: "Extract defaults into a constant to prevent silent divergence"

## Proposed Solutions

### Option A: Extract to constant (Recommended)

```typescript
const AUDIT_DEFAULTS = { log_directory: '/data/logs/', retention_days: 90 } as const;

const auditSchema = z
  .object({
    log_directory: z.string().min(1).default(AUDIT_DEFAULTS.log_directory),
    retention_days: z.number().int().min(1).default(AUDIT_DEFAULTS.retention_days),
  })
  .default(AUDIT_DEFAULTS);
```

**Pros:** Single source of truth, prevents divergence
**Cons:** Slightly more verbose
**Effort:** Small
**Risk:** Low

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `src/config/config.schema.ts`

## Acceptance Criteria

- [ ] Defaults defined in one place
- [ ] All tests pass

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-15 | Created from code review | TypeScript reviewer finding |

## Resources

- PR branch: `logging`
