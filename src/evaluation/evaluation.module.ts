import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { MediaModule } from '../media/media.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { SnapshotModule } from '../snapshot/snapshot.module.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationService } from './evaluation.service.js';

@Module({
  imports: [ConfigModule, MediaModule, RulesModule, SnapshotModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
})
export class EvaluationModule {}
