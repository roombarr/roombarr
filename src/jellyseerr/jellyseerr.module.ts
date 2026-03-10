import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { JellyseerrClient } from './jellyseerr.client';
import { JellyseerrService } from './jellyseerr.service';

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
  providers: [JellyseerrClient, JellyseerrService],
  exports: [JellyseerrService],
})
export class JellyseerrModule {}
