import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { ImportListController } from './import-list.controller';
import { ImportListGuardService } from './import-list-guard.service';
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
    SnapshotModule,
  ],
  controllers: [ImportListController],
  providers: [RadarrClient, RadarrService, ImportListGuardService],
  exports: [RadarrClient, RadarrService],
})
export class RadarrModule {}
