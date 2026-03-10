import { Module, RequestMethod } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { HealthModule } from './health/health.module';
import { JellyfinModule } from './jellyfin/jellyfin.module';
import { JellyseerrModule } from './jellyseerr/jellyseerr.module';
import { MediaModule } from './media/media.module';
import { RadarrModule } from './radarr/radarr.module';
import { RulesModule } from './rules/rules.module';
import { SonarrModule } from './sonarr/sonarr.module';

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
    AuditModule,
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
