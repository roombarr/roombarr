import { Controller, Get, Inject } from '@nestjs/common';
import { FieldRegistryService } from './field-registry.service.js';
import { INTEGRATION_PROVIDER } from './integration.constants.js';
import type { IntegrationProvider } from './integration.types.js';

interface ProviderSummary {
  name: string;
  capabilities: {
    canFetchMedia: boolean;
    canEnrich: boolean;
    canExecuteActions: boolean;
  };
  fieldCount: number;
}

@Controller('providers')
export class IntrospectionController {
  constructor(
    @Inject(INTEGRATION_PROVIDER)
    private readonly providers: IntegrationProvider[],
    private readonly fieldRegistry: FieldRegistryService,
  ) {}

  /** Returns a summary of all registered integration providers and their capabilities. */
  @Get()
  listProviders(): ProviderSummary[] {
    const registry = this.fieldRegistry.getRegistry();

    return this.providers.map(provider => {
      const fields = registry[provider.name];
      const fieldCount = fields ? Object.keys(fields).length : 0;

      return {
        name: provider.name,
        capabilities: {
          canFetchMedia: !!provider.fetchMedia,
          canEnrich: !!provider.enrichMedia,
          canExecuteActions: !!provider.executeAction,
        },
        fieldCount,
      };
    });
  }
}
