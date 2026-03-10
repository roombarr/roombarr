import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { RadarrClient } from './radarr.client';
import { RadarrService } from './radarr.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const radarr = config.getConfig().services.radarr;
        return {
          baseURL: radarr?.base_url,
          headers: radarr ? { 'X-Api-Key': radarr.api_key } : {},
          timeout: 30_000,
        };
      },
    }),
  ],
  providers: [RadarrClient, RadarrService],
  exports: [RadarrClient, RadarrService],
})
export class RadarrModule {}
