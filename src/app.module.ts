import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { RulesModule } from './rules/rules.module.js';

@Module({
  imports: [ConfigModule, RulesModule],
})
export class AppModule {}
