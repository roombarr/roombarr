import { Module, RequestMethod } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';
import { HealthModule } from './health/health.module.js';
import { JellyfinModule } from './jellyfin/jellyfin.module.js';
import { JellyseerrModule } from './jellyseerr/jellyseerr.module.js';
import { MediaModule } from './media/media.module.js';
import { RadarrModule } from './radarr/radarr.module.js';
import { RulesModule } from './rules/rules.module.js';
import { SonarrModule } from './sonarr/sonarr.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
      },
      exclude: [{ method: RequestMethod.ALL, path: 'health' }],
    }),
    ScheduleModule.forRoot(),
    ConfigModule,
    DatabaseModule,
    RulesModule,
    SonarrModule,
    RadarrModule,
    JellyfinModule,
    JellyseerrModule,
    MediaModule,
    EvaluationModule,
    HealthModule,
  ],
})
export class AppModule {}
