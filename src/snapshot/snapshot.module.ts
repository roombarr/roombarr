import { Module } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';
import { StateService } from './state.service';

@Module({
  providers: [SnapshotService, StateService],
  exports: [SnapshotService, StateService],
})
export class SnapshotModule {}
