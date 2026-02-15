import { Module } from '@nestjs/common';
import { SnapshotService } from './snapshot.service.js';
import { StateService } from './state.service.js';

@Module({
  providers: [SnapshotService, StateService],
  exports: [SnapshotService, StateService],
})
export class SnapshotModule {}
