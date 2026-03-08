import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { SonarrClient } from './sonarr.client.js';
import { SonarrProvider } from './sonarr.provider.js';
import { SonarrService } from './sonarr.service.js';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const sonarr = config.getConfig().services.sonarr;
        return {
          baseURL: sonarr?.base_url,
          headers: sonarr ? { 'X-Api-Key': sonarr.api_key } : {},
          timeout: 30_000,
        };
      },
    }),
  ],
  providers: [SonarrClient, SonarrService, SonarrProvider],
  exports: [SonarrClient, SonarrService, SonarrProvider],
})
export class SonarrModule {}
