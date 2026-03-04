import { z } from 'zod';
import { isValidDuration } from '../shared/duration.js';
import {
  type FieldDefinition,
  getFieldDefinition,
  getServiceFromField,
  isOperatorCompatible,
} from './field-registry.js';

const serviceConfigSchema = z.object({
  base_url: z.url(),
  api_key: z.string().min(1),
});

const conditionOperators = [
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'older_than',
  'newer_than',
  'includes',
  'not_includes',
  'includes_all',
  'is_empty',
  'is_not_empty',
] as const;

export type ConditionOperator = (typeof conditionOperators)[number];

export type Action = 'delete' | 'unmonitor' | 'keep';

export interface LeafCondition {
  field: string;
  operator: ConditionOperator;
  value?: string | number | boolean | string[];
}

export interface ConditionGroup {
  operator: 'AND' | 'OR';
  children: Condition[];
}

export type Condition = LeafCondition | ConditionGroup;

export interface RuleConfig {
  name: string;
  target: 'sonarr' | 'radarr';
  conditions: ConditionGroup;
  action: Action;
}

export interface ServiceConfig {
  base_url: string;
  api_key: string;
}

export interface RoombarrConfig {
  services: {
    sonarr?: ServiceConfig;
    radarr?: ServiceConfig;
    jellyfin?: ServiceConfig;
    jellyseerr?: ServiceConfig;
  };
  schedule: string;
  performance: {
    concurrency: number;
  };
  audit: {
    log_directory: string;
    retention_days: number;
  };
  rules: RuleConfig[];
}

// --- Zod schemas for runtime validation ---

const leafConditionSchema = z.object({
  field: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  operator: z.enum(conditionOperators),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .optional(),
});

const conditionGroupSchema: z.ZodType<ConditionGroup> = z.object({
  operator: z.enum(['AND', 'OR']),
  get children() {
    return z.array(z.union([leafConditionSchema, conditionGroupSchema])).min(1);
  },
});

const conditionSchema = z.union([leafConditionSchema, conditionGroupSchema]);

const actionSchema = z.enum(['delete', 'unmonitor', 'keep']);

const ruleSchema = z.object({
  name: z.string().min(1),
  target: z.enum(['sonarr', 'radarr']),
  conditions: conditionGroupSchema,
  action: actionSchema,
});

const performanceSchema = z
  .object({
    concurrency: z.number().int().min(1).max(50).default(10),
  })
  .default({ concurrency: 10 });

const AUDIT_DEFAULTS = {
  log_directory: '/config/logs/',
  retention_days: 90,
} as const;

const auditSchema = z
  .object({
    log_directory: z.string().min(1).default(AUDIT_DEFAULTS.log_directory),
    retention_days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(AUDIT_DEFAULTS.retention_days),
  })
  .default(AUDIT_DEFAULTS);

const servicesSchema = z.object({
  sonarr: serviceConfigSchema.optional(),
  radarr: serviceConfigSchema.optional(),
  jellyfin: serviceConfigSchema.optional(),
  jellyseerr: serviceConfigSchema.optional(),
});

export const configSchema = z.object({
  services: servicesSchema,
  schedule: z.string().min(1),
  performance: performanceSchema,
  audit: auditSchema,
  rules: z.array(ruleSchema).min(1),
});

export { conditionSchema, leafConditionSchema, conditionGroupSchema };

/**
 * Cross-validation errors that Zod schemas alone can't express.
 * Called after schema validation succeeds.
 */
export function validateConfig(config: RoombarrConfig): string[] {
  const errors: string[] = [];

  if (!config.services.sonarr && !config.services.radarr) {
    errors.push(
      'At least one of services.sonarr or services.radarr must be configured',
    );
  }

  for (const rule of config.rules) {
    // Rule target requires the corresponding service
    if (rule.target === 'sonarr' && !config.services.sonarr) {
      errors.push(
        `Rule "${rule.name}" targets sonarr but services.sonarr is not configured`,
      );
    }
    if (rule.target === 'radarr' && !config.services.radarr) {
      errors.push(
        `Rule "${rule.name}" targets radarr but services.radarr is not configured`,
      );
    }

    // Validate all conditions in the rule
    const conditionErrors = validateConditions(
      rule.conditions,
      rule.target,
      rule.name,
      config.services,
    );
    errors.push(...conditionErrors);
  }

  return errors;
}

function validateConditions(
  condition: Condition,
  target: 'sonarr' | 'radarr',
  ruleName: string,
  services: RoombarrConfig['services'],
): string[] {
  const errors: string[] = [];

  if ('field' in condition) {
    errors.push(
      ...validateLeafCondition(condition, target, ruleName, services),
    );
  } else if ('children' in condition) {
    for (const child of condition.children) {
      errors.push(...validateConditions(child, target, ruleName, services));
    }
  }

  return errors;
}

function validateLeafCondition(
  condition: LeafCondition,
  target: 'sonarr' | 'radarr',
  ruleName: string,
  services: RoombarrConfig['services'],
): string[] {
  const errors: string[] = [];
  const { field, operator, value } = condition;

  // Check field exists in registry
  const fieldDef: FieldDefinition | undefined = getFieldDefinition(
    target,
    field,
  );
  if (!fieldDef) {
    errors.push(
      `Rule "${ruleName}": unknown field "${field}" for target "${target}"`,
    );
    return errors;
  }

  // Check enrichment service is configured
  const service = getServiceFromField(field);
  if (service === 'jellyfin' && !services.jellyfin) {
    errors.push(
      `Rule "${ruleName}": field "${field}" requires services.jellyfin to be configured`,
    );
  }
  if (service === 'jellyseerr' && !services.jellyseerr) {
    errors.push(
      `Rule "${ruleName}": field "${field}" requires services.jellyseerr to be configured`,
    );
  }

  // Check operator compatibility with field type
  if (!isOperatorCompatible(operator, fieldDef.type)) {
    errors.push(
      `Rule "${ruleName}": operator "${operator}" is not compatible with field "${field}" (type: ${fieldDef.type})`,
    );
  }

  // is_empty/is_not_empty must not have a value
  if (
    (operator === 'is_empty' || operator === 'is_not_empty') &&
    value !== undefined
  ) {
    errors.push(
      `Rule "${ruleName}": operator "${operator}" must not have a value`,
    );
  }

  // All other operators must have a value
  if (
    operator !== 'is_empty' &&
    operator !== 'is_not_empty' &&
    value === undefined
  ) {
    errors.push(`Rule "${ruleName}": operator "${operator}" requires a value`);
  }

  // older_than/newer_than values must be valid duration strings
  if (
    (operator === 'older_than' || operator === 'newer_than') &&
    typeof value === 'string' &&
    !isValidDuration(value)
  ) {
    errors.push(
      `Rule "${ruleName}": invalid duration "${value}" for operator "${operator}". Expected format: <number><unit> (d/w/m/y)`,
    );
  }

  return errors;
}
