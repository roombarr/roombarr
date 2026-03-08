import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { JellyseerrClient } from './jellyseerr.client.js';
import { JellyseerrProvider } from './jellyseerr.provider.js';
import { JellyseerrService } from './jellyseerr.service.js';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jellyseerr = config.getConfig().services.jellyseerr;
        return {
          baseURL: jellyseerr?.base_url,
          headers: jellyseerr ? { 'X-Api-Key': jellyseerr.api_key } : {},
          timeout: 30_000,
        };
      },
    }),
  ],
  providers: [JellyseerrClient, JellyseerrService, JellyseerrProvider],
  exports: [JellyseerrService, JellyseerrProvider],
})
export class JellyseerrModule {}
