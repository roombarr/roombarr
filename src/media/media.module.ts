import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { JellyfinModule } from '../jellyfin/jellyfin.module.js';
import { JellyfinService } from '../jellyfin/jellyfin.service.js';
import { JellyseerrModule } from '../jellyseerr/jellyseerr.module.js';
import { JellyseerrService } from '../jellyseerr/jellyseerr.service.js';
import { RadarrModule } from '../radarr/radarr.module.js';
import { RadarrService } from '../radarr/radarr.service.js';
import { SonarrModule } from '../sonarr/sonarr.module.js';
import { SonarrService } from '../sonarr/sonarr.service.js';
import { MediaService } from './media.service.js';

/**
 * Orchestration module that imports all service modules and wires
 * the MediaService with optional dependencies based on config.
 *
 * Services that aren't configured are injected as null, allowing
 * the MediaService to gracefully skip them during hydration.
 */
@Module({
  imports: [SonarrModule, RadarrModule, JellyfinModule, JellyseerrModule],
  providers: [
    {
      provide: MediaService,
      inject: [
        ConfigService,
        { token: SonarrService, optional: true },
        { token: RadarrService, optional: true },
        { token: JellyfinService, optional: true },
        { token: JellyseerrService, optional: true },
      ],
      useFactory: (
        _config: ConfigService,
        sonarr?: SonarrService,
        radarr?: RadarrService,
        jellyfin?: JellyfinService,
        jellyseerr?: JellyseerrService,
      ) =>
        new MediaService(
          sonarr ?? null,
          radarr ?? null,
          jellyfin ?? null,
          jellyseerr ?? null,
        ),
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
