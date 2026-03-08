import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FieldDefinition, FieldType } from '../config/field-registry.js';
import type { StateFieldPattern } from '../snapshot/state-registry.js';
import { INTEGRATION_PROVIDER } from './integration.constants.js';
import type { IntegrationProvider } from './integration.types.js';

/** Maps state field pattern types to their corresponding field types. */
const statePatternFieldType: Record<StateFieldPattern['type'], FieldType> = {
  days_since_value: 'number',
  ever_was_value: 'boolean',
};

/**
 * Auto-composed field registry built at startup from all registered providers.
 * Each base target (radarr, sonarr) gets its own fields + all enrichment
 * provider fields + state fields derived from provider state patterns.
 */
@Injectable()
export class FieldRegistryService {
  private readonly logger = new Logger(FieldRegistryService.name);
  private readonly registry: Record<string, Record<string, FieldDefinition>>;

  constructor(
    @Inject(INTEGRATION_PROVIDER)
    private readonly providers: IntegrationProvider[],
  ) {
    this.registry = this.buildRegistry();
  }

  /** Looks up a field definition for a given target and field path. */
  getFieldDefinition(
    target: string,
    fieldPath: string,
  ): FieldDefinition | undefined {
    return this.registry[target]?.[fieldPath];
  }

  /** Returns all registered targets and their field maps (for debugging/introspection). */
  getRegistry(): Readonly<
    Record<string, Readonly<Record<string, FieldDefinition>>>
  > {
    return this.registry;
  }

  /**
   * Builds the composed registry by:
   * 1. Collecting field definitions from all providers
   * 2. Deriving state field definitions from provider state patterns
   * 3. Composing per-target registries: base fields + enrichment fields + state fields
   */
  private buildRegistry(): Record<string, Record<string, FieldDefinition>> {
    const baseProviders = this.providers.filter(p => !!p.fetchMedia);
    const enrichmentProviders = this.providers.filter(p => !!p.enrichMedia);

    const enrichmentFields = this.collectEnrichmentFields(enrichmentProviders);
    const stateFields = this.collectStateFields();

    const registry: Record<string, Record<string, FieldDefinition>> = {};

    for (const provider of baseProviders) {
      registry[provider.name] = Object.freeze({
        ...provider.getFieldDefinitions(),
        ...enrichmentFields,
        ...stateFields[provider.name],
      });
    }

    return Object.freeze(registry);
  }

  /** Merges field definitions from all enrichment providers into a single record. */
  private collectEnrichmentFields(
    enrichmentProviders: IntegrationProvider[],
  ): Record<string, FieldDefinition> {
    const fields: Record<string, FieldDefinition> = {};

    for (const provider of enrichmentProviders) {
      const providerFields = provider.getFieldDefinitions();

      for (const fieldPath of Object.keys(providerFields)) {
        if (fieldPath in fields) {
          this.logger.warn(
            `Enrichment field "${fieldPath}" from provider "${provider.name}" overwrites an existing definition`,
          );
        }
      }

      Object.assign(fields, providerFields);
    }

    return fields;
  }

  /**
   * Collects state field patterns from all providers and derives FieldDefinition
   * entries keyed by target. A pattern's `targets` array determines which base
   * targets receive the derived field definition.
   */
  private collectStateFields(): Record<
    string,
    Record<string, FieldDefinition>
  > {
    const byTarget: Record<string, Record<string, FieldDefinition>> = {};

    for (const provider of this.providers) {
      const patterns = provider.getStateFieldPatterns?.();
      if (!patterns) continue;

      for (const [fieldPath, pattern] of Object.entries(patterns)) {
        const fieldDef: FieldDefinition = {
          type: statePatternFieldType[pattern.type],
          service: 'state',
        };

        for (const target of pattern.targets) {
          byTarget[target] ??= {};

          if (fieldPath in byTarget[target]) {
            this.logger.warn(
              `State field "${fieldPath}" from provider "${provider.name}" overwrites an existing definition for target "${target}"`,
            );
          }

          byTarget[target][fieldPath] = fieldDef;
        }
      }
    }

    return byTarget;
  }
}
