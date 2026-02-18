import type { ConditionGroup } from '../config/config.schema.js';

/** Build a human-readable reasoning string from a condition tree. */
export function buildReasoning(conditions: ConditionGroup): string {
  return formatConditionGroup(conditions);
}

function formatConditionGroup(group: ConditionGroup): string {
  const parts = group.children.map(child => {
    if ('field' in child) {
      return formatLeafCondition(child);
    }
    return formatConditionGroup(child as ConditionGroup);
  });

  if (parts.length === 1) return parts[0];
  return `(${parts.join(` ${group.operator} `)})`;
}

function formatLeafCondition(condition: {
  field: string;
  operator: string;
  value?: unknown;
}): string {
  const { field, operator, value } = condition;

  if (operator === 'is_empty') return `${field} is empty`;
  if (operator === 'is_not_empty') return `${field} is not empty`;

  const displayOp = operator.replace(/_/g, ' ');
  return `${field} ${displayOp} ${JSON.stringify(value)}`;
}
