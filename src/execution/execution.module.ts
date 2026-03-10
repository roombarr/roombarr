import { Module } from '@nestjs/common';
import { RadarrModule } from '../radarr/radarr.module';
import { SonarrModule } from '../sonarr/sonarr.module';
import { ActionExecutorService } from './action-executor.service';

@Module({
  imports: [RadarrModule, SonarrModule],
  providers: [ActionExecutorService],
  exports: [ActionExecutorService],
})
export class ExecutionModule {}
