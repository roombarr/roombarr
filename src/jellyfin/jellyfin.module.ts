import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import type { ServiceConfig } from '../config/config.schema';
import { ConfigService } from '../config/config.service';
import { JellyfinClient } from './jellyfin.client';
import { JellyfinService } from './jellyfin.service';

/**
 * Build the authorization headers for outbound Jellyfin requests.
 *
 * Jellyfin 12.0 ships a migration that disables legacy authorization by
 * default on new and upgraded servers alike, which rejects `X-Emby-Token`,
 * `X-MediaBrowser-Token` and the `api_key` query param with a bodyless 401.
 * The `MediaBrowser` scheme is accepted by both 10.x and 12.x, so it needs no
 * version negotiation.
 *
 * @param jellyfin - Jellyfin service config, or undefined when not configured
 * @returns Headers to attach to every Jellyfin request; empty when unconfigured
 */
export function buildJellyfinAuthHeaders(
  jellyfin: ServiceConfig | undefined,
): Record<string, string> {
  if (!jellyfin) return {};

  return { Authorization: `MediaBrowser Token="${jellyfin.api_key}"` };
}

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jellyfin = config.getConfig().services.jellyfin;
        return {
          baseURL: jellyfin?.base_url,
          headers: buildJellyfinAuthHeaders(jellyfin),
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
