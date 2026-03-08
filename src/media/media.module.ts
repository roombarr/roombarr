import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { MediaService } from './media.service.js';

/**
 * Orchestration module that imports IntegrationModule to get
 * all registered providers and wires the MediaService.
 */
@Module({
  imports: [IntegrationModule],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
