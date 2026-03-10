import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { SonarrClient } from './sonarr.client';
import { SonarrService } from './sonarr.service';

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
  providers: [SonarrClient, SonarrService],
  exports: [SonarrClient, SonarrService],
})
export class SonarrModule {}
