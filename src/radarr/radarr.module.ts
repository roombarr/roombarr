import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { RadarrClient } from './radarr.client.js';
import { RadarrProvider } from './radarr.provider.js';
import { RadarrService } from './radarr.service.js';

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
  providers: [RadarrClient, RadarrService, RadarrProvider],
  exports: [RadarrClient, RadarrService, RadarrProvider],
})
export class RadarrModule {}
