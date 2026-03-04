import { Module } from '@nestjs/common';
import { RadarrModule } from '../radarr/radarr.module.js';
import { SonarrModule } from '../sonarr/sonarr.module.js';
import { ActionExecutorService } from './action-executor.service.js';

@Module({
  imports: [RadarrModule, SonarrModule],
  providers: [ActionExecutorService],
  exports: [ActionExecutorService],
})
export class ExecutionModule {}
