import type { Condition, RoombarrConfig } from '../config/config.schema.js';

/** Walks a condition tree collecting errors for fields with the given prefix. */
export function collectUnconfiguredFieldErrors(
  condition: Condition | { field: string },
  prefix: string,
  ruleName: string,
  serviceName: string,
  errors: string[],
): void {
  if ('field' in condition) {
    if ((condition.field as string).startsWith(prefix)) {
      errors.push(
        `Rule "${ruleName}": field "${condition.field}" requires services.${serviceName} to be configured`,
      );
    }
    return;
  }
  if ('children' in condition) {
    for (const child of condition.children) {
      collectUnconfiguredFieldErrors(
        child,
        prefix,
        ruleName,
        serviceName,
        errors,
      );
    }
  }
}

/**
 * Collects errors for rules that target a provider whose service
 * is not configured in the config.
 */
export function collectUnconfiguredTargetErrors(
  config: RoombarrConfig,
  providerName: string,
): string[] {
  const errors: string[] = [];
  const serviceConfig =
    config.services[providerName as keyof typeof config.services];

  for (const rule of config.rules) {
    if (rule.target === providerName && !serviceConfig) {
      errors.push(
        `Rule "${rule.name}" targets ${providerName} but services.${providerName} is not configured`,
      );
    }
  }

  return errors;
}
