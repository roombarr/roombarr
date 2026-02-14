import { Module } from '@nestjs/common';
import { RulesService } from './rules.service.js';

@Module({
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
