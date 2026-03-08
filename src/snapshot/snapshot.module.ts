import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { SnapshotService } from './snapshot.service.js';
import { StateService } from './state.service.js';

@Module({
  imports: [IntegrationModule],
  providers: [SnapshotService, StateService],
  exports: [SnapshotService, StateService],
})
export class SnapshotModule {}
