import {
  type ConditionGroup,
  type LeafCondition,
  VALUELESS_OPERATORS,
} from '../config/config.schema';

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

function formatLeafCondition(condition: LeafCondition): string {
  const { field, operator, value } = condition;
  const displayOp = operator.replace(/_/g, ' ');

  if (VALUELESS_OPERATORS.has(operator)) return `${field} ${displayOp}`;

  return `${field} ${displayOp} ${JSON.stringify(value)}`;
}
