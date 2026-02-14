import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { JellyfinModule } from './jellyfin/jellyfin.module.js';
import { RadarrModule } from './radarr/radarr.module.js';
import { RulesModule } from './rules/rules.module.js';
import { SonarrModule } from './sonarr/sonarr.module.js';

@Module({
  imports: [
    ConfigModule,
    RulesModule,
    SonarrModule,
    RadarrModule,
    JellyfinModule,
  ],
})
export class AppModule {}
