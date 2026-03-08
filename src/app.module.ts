import { Module, RequestMethod } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';
import { HealthModule } from './health/health.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { MediaModule } from './media/media.module.js';
import { RulesModule } from './rules/rules.module.js';

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
    IntegrationModule,
    MediaModule,
    EvaluationModule,
    HealthModule,
  ],
})
export class AppModule {}
