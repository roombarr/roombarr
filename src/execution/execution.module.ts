import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { ActionExecutorService } from './action-executor.service.js';

@Module({
  imports: [IntegrationModule],
  providers: [ActionExecutorService],
  exports: [ActionExecutorService],
})
export class ExecutionModule {}
