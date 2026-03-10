import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { JellyfinModule } from '../jellyfin/jellyfin.module';
import { JellyfinService } from '../jellyfin/jellyfin.service';
import { JellyseerrModule } from '../jellyseerr/jellyseerr.module';
import { JellyseerrService } from '../jellyseerr/jellyseerr.service';
import { RadarrModule } from '../radarr/radarr.module';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrModule } from '../sonarr/sonarr.module';
import { SonarrService } from '../sonarr/sonarr.service';
import { MediaService } from './media.service';

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
