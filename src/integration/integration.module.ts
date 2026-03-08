import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { JellyfinModule } from '../jellyfin/jellyfin.module.js';
import { JellyfinProvider } from '../jellyfin/jellyfin.provider.js';
import { JellyseerrModule } from '../jellyseerr/jellyseerr.module.js';
import { JellyseerrProvider } from '../jellyseerr/jellyseerr.provider.js';
import { RadarrModule } from '../radarr/radarr.module.js';
import { RadarrProvider } from '../radarr/radarr.provider.js';
import { SonarrModule } from '../sonarr/sonarr.module.js';
import { SonarrProvider } from '../sonarr/sonarr.provider.js';
import { ConfigValidationService } from './config-validation.service.js';
import { FieldRegistryService } from './field-registry.service.js';
import { INTEGRATION_PROVIDER } from './integration.constants.js';
import type { IntegrationProvider } from './integration.types.js';
import { IntrospectionController } from './introspection.controller.js';

/**
 * Central orchestration module that collects all IntegrationProvider
 * instances into a single injection token and exposes the composed
 * FieldRegistryService for downstream consumers.
 *
 * Only providers whose services are configured in YAML are registered
 * with the INTEGRATION_PROVIDER token — unconfigured services are
 * excluded from fetch/enrich/execute loops.
 */
@Module({
  imports: [RadarrModule, SonarrModule, JellyfinModule, JellyseerrModule],
  controllers: [IntrospectionController],
  providers: [
    {
      provide: INTEGRATION_PROVIDER,
      inject: [
        ConfigService,
        RadarrProvider,
        SonarrProvider,
        JellyfinProvider,
        JellyseerrProvider,
      ],
      useFactory: (
        config: ConfigService,
        ...providers: IntegrationProvider[]
      ): IntegrationProvider[] => {
        const services = config.getConfig().services;
        return providers.filter(
          p => !!services[p.name as keyof typeof services],
        );
      },
    },
    FieldRegistryService,
    ConfigValidationService,
  ],
  exports: [INTEGRATION_PROVIDER, FieldRegistryService],
})
export class IntegrationModule {}
