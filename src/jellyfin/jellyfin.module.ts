import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { JellyfinClient } from './jellyfin.client';
import { JellyfinService } from './jellyfin.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jellyfin = config.getConfig().services.jellyfin;
        return {
          baseURL: jellyfin?.base_url,
          headers: jellyfin ? { 'X-Emby-Token': jellyfin.api_key } : {},
          timeout: 30_000,
        };
      },
    }),
  ],
  providers: [
    JellyfinClient,
    {
      provide: JellyfinService,
      inject: [JellyfinClient, ConfigService],
      useFactory: (client: JellyfinClient, config: ConfigService) =>
        new JellyfinService(client, config.getConfig().performance.concurrency),
    },
  ],
  exports: [JellyfinService],
})
export class JellyfinModule {}
