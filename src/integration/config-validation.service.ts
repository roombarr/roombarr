import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import parse from 'parse-duration';
import type {
  Condition,
  ConditionOperator,
  LeafCondition,
  RoombarrConfig,
} from '../config/config.schema.js';
import { ConfigService } from '../config/config.service.js';
import type { FieldDefinition, FieldType } from '../config/field-registry.js';
import { FieldRegistryService } from './field-registry.service.js';
import { INTEGRATION_PROVIDER } from './integration.constants.js';
import type { IntegrationProvider } from './integration.types.js';

/**
 * Cross-validation service that runs after all modules are initialized.
 * Delegates per-service checks to providers and uses FieldRegistryService
 * for field existence and operator compatibility validation.
 */
@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly fieldRegistryService: FieldRegistryService,
    @Inject(INTEGRATION_PROVIDER)
    private readonly providers: IntegrationProvider[],
  ) {}

  onModuleInit(): void {
    const config = this.configService.getConfig();
    const errors = this.validate(config);
    if (errors.length > 0) {
      throw new Error(
        `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      );
    }
    this.logger.log('Configuration cross-validation passed');
  }

  /** Runs all cross-validation checks and returns error strings. */
  validate(config: RoombarrConfig): string[] {
    const errors: string[] = [];

    // Shared: at least one arr service must be configured
    if (!config.services.sonarr && !config.services.radarr) {
      errors.push(
        'At least one of services.sonarr or services.radarr must be configured',
      );
    }

    // Delegate per-service validation to providers
    for (const provider of this.providers) {
      errors.push(...provider.validateConfig(config));
    }

    // Validate all conditions in each rule (field existence, operator compat, etc.)
    for (const rule of config.rules) {
      errors.push(
        ...this.validateConditions(rule.conditions, rule.target, rule.name),
      );
    }

    return errors;
  }

  private validateConditions(
    condition: Condition,
    target: string,
    ruleName: string,
  ): string[] {
    const errors: string[] = [];

    if ('field' in condition) {
      errors.push(...this.validateLeafCondition(condition, target, ruleName));
    } else if ('children' in condition) {
      for (const child of condition.children) {
        errors.push(...this.validateConditions(child, target, ruleName));
      }
    }

    return errors;
  }

  private validateLeafCondition(
    condition: LeafCondition,
    target: string,
    ruleName: string,
  ): string[] {
    const errors: string[] = [];
    const { field, operator, value } = condition;

    // Check field exists in the composed registry
    const fieldDef: FieldDefinition | undefined =
      this.fieldRegistryService.getFieldDefinition(target, field);
    if (!fieldDef) {
      errors.push(
        `Rule "${ruleName}": unknown field "${field}" for target "${target}"`,
      );
      return errors;
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
      errors.push(
        `Rule "${ruleName}": operator "${operator}" requires a value`,
      );
    }

    // older_than/newer_than values must be valid, positive duration strings
    if (operator === 'older_than' || operator === 'newer_than') {
      if (typeof value !== 'string') {
        errors.push(
          `Rule "${ruleName}": operator "${operator}" requires a duration string, got ${typeof value}`,
        );
      } else {
        const ms = parse(value);
        if (ms === null || ms <= 0) {
          errors.push(
            `Rule "${ruleName}": invalid duration "${value}" for operator "${operator}". Examples: 30d, 2w, 6mo, 1y. See https://github.com/jkroso/parse-duration for full syntax`,
          );
        }
      }
    }

    return errors;
  }
}

/** Operator-to-field-type compatibility matrix. */
const operatorTypeCompatibility: Record<ConditionOperator, FieldType[]> = {
  equals: ['string', 'number', 'boolean'],
  not_equals: ['string', 'number', 'boolean'],
  greater_than: ['number'],
  less_than: ['number'],
  older_than: ['date'],
  newer_than: ['date'],
  includes: ['array'],
  not_includes: ['array'],
  includes_all: ['array'],
  is_empty: ['array'],
  is_not_empty: ['array'],
};

/** Checks whether an operator is compatible with a given field type. */
export function isOperatorCompatible(
  operator: ConditionOperator,
  fieldType: FieldType,
): boolean {
  const compatible = operatorTypeCompatibility[operator];
  if (!compatible) return false;
  return compatible.includes(fieldType);
}
