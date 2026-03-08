import { z } from 'zod';

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
  dry_run: boolean;
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
  retention_days: 90,
} as const;

const auditSchema = z
  .object({
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
  dry_run: z.boolean().default(true),
  services: servicesSchema,
  schedule: z.string().min(1),
  performance: performanceSchema,
  audit: auditSchema,
  rules: z.array(ruleSchema).min(1),
});

export { conditionSchema, leafConditionSchema, conditionGroupSchema };
