import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Condition, RuleConfig } from '../config/config.schema.js';
import { getServiceFromField } from '../config/field-registry.js';
import { INTEGRATION_PROVIDER } from '../integration/integration.constants.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import type { UnifiedMedia } from '../shared/types.js';

/**
 * Orchestrates data hydration from all configured providers.
 * Analyzes rules to determine which providers are needed,
 * fetches data lazily (only from referenced providers),
 * and enriches items through the provider pipeline.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly fetchProviders: IntegrationProvider[];
  private readonly enrichProviders: IntegrationProvider[];

  constructor(
    @Inject(INTEGRATION_PROVIDER)
    readonly providers: IntegrationProvider[],
  ) {
    this.fetchProviders = providers.filter(p => !!p.fetchMedia);
    this.enrichProviders = providers.filter(p => !!p.enrichMedia);
  }

  /**
   * Hydrate unified media models based on the given rules.
   * Only fetches from providers whose targets match rule targets,
   * and only enriches from providers whose names appear in rule field prefixes.
   */
  async hydrate(rules: RuleConfig[]): Promise<UnifiedMedia[]> {
    const neededServices = this.analyzeNeededServices(rules);
    const ruleTargets = new Set<string>(rules.map(r => r.target));

    this.logger.log(
      `Hydrating media: services needed = [${[...neededServices].join(', ')}]`,
    );

    // Fetch base data from all matching fetch providers in parallel
    const fetchResults = await Promise.all(
      this.fetchProviders
        .filter(p => ruleTargets.has(p.name))
        .map(async p => {
          try {
            return (await p.fetchMedia?.()) ?? [];
          } catch (error) {
            this.logger.warn(`${p.name} fetch failed, skipping: ${error}`);
            return [];
          }
        }),
    );
    let items: UnifiedMedia[] = fetchResults.flat();

    // Run enrichment providers sequentially (each sees the previous provider's output)
    for (const provider of this.enrichProviders) {
      if (!neededServices.has(provider.name)) continue;
      try {
        items = (await provider.enrichMedia?.(items)) ?? items;
      } catch (error) {
        this.logger.warn(
          `${provider.name} enrichment failed, skipping: ${error}`,
        );
      }
    }

    let movieCount = 0;
    let seasonCount = 0;
    for (const item of items) {
      if (item.type === 'movie') movieCount++;
      else seasonCount++;
    }
    this.logger.log(
      `Hydration complete: ${movieCount} movies, ${seasonCount} seasons`,
    );

    return items;
  }

  /**
   * Analyze all rules to determine which services are referenced
   * in their conditions. Only those services need to be queried.
   */
  private analyzeNeededServices(rules: RuleConfig[]): Set<string> {
    const services = new Set<string>();

    for (const rule of rules) {
      this.collectServicePrefixes(rule.conditions, services);
    }

    return services;
  }

  private collectServicePrefixes(
    condition: Condition,
    services: Set<string>,
  ): void {
    if ('field' in condition) {
      services.add(getServiceFromField(condition.field));
    } else if ('children' in condition) {
      for (const child of condition.children) {
        this.collectServicePrefixes(child, services);
      }
    }
  }
}
