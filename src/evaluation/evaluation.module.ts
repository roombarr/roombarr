import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ExecutionModule } from '../execution/execution.module';
import { MediaModule } from '../media/media.module';
import { RulesModule } from '../rules/rules.module';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [
    ConfigModule,
    MediaModule,
    RulesModule,
    SnapshotModule,
    ExecutionModule,
  ],
  controllers: [EvaluationController],
  providers: [EvaluationService],
})
export class EvaluationModule {}
