import { Injectable, Logger } from '@nestjs/common';
import type { Action, RoombarrConfig } from '../config/config.schema.js';
import type { FieldDefinition } from '../config/field-registry.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import { collectUnconfiguredTargetErrors } from '../integration/validation-utils.js';
import type { UnifiedMedia, UnifiedMovie } from '../shared/types.js';
import type { StateFieldPattern } from '../snapshot/state-registry.js';
import { RadarrClient } from './radarr.client.js';
import { radarrFields } from './radarr.fields.js';
import { RadarrService } from './radarr.service.js';

@Injectable()
export class RadarrProvider implements IntegrationProvider {
  readonly name = 'radarr';

  private readonly logger = new Logger(RadarrProvider.name);

  constructor(
    private readonly radarrService: RadarrService,
    private readonly radarrClient: RadarrClient,
  ) {}

  getFieldDefinitions(): Record<string, FieldDefinition> {
    return radarrFields;
  }

  validateConfig(config: RoombarrConfig): string[] {
    return collectUnconfiguredTargetErrors(config, this.name);
  }

  async fetchMedia(): Promise<UnifiedMedia[]> {
    return this.radarrService.fetchMovies();
  }

  async executeAction(item: UnifiedMedia, action: Action): Promise<void> {
    if (item.type !== 'movie') return;

    switch (action) {
      case 'delete':
        return this.deleteMovie(item);
      case 'unmonitor':
        return this.unmonitorMovie(item);
      case 'keep':
        return;
    }
  }

  getStateFieldPatterns(): Record<string, StateFieldPattern> {
    return {
      'state.days_off_import_list': {
        type: 'days_since_value',
        tracks: 'radarr.on_import_list',
        value: 'false',
        nullWhenCurrentNot: true,
        targets: ['radarr'],
      },
      'state.ever_on_import_list': {
        type: 'ever_was_value',
        tracks: 'radarr.on_import_list',
        value: 'true',
        targets: ['radarr'],
      },
    };
  }

  private async deleteMovie(movie: UnifiedMovie): Promise<void> {
    this.logger.log(
      `Deleting movie "${movie.title}" (radarr_id: ${movie.radarr_id})`,
    );
    await this.radarrClient.deleteMovie(movie.radarr_id);
  }

  /**
   * Unmonitor a movie by re-fetching the full resource from Radarr,
   * flipping `monitored` to false, and PUTting the full body back.
   * This avoids metadata corruption from partial request bodies.
   */
  private async unmonitorMovie(movie: UnifiedMovie): Promise<void> {
    this.logger.log(
      `Unmonitoring movie "${movie.title}" (radarr_id: ${movie.radarr_id})`,
    );
    const fresh = await this.radarrClient.fetchMovie(movie.radarr_id);
    fresh.monitored = false;
    await this.radarrClient.updateMovie(movie.radarr_id, fresh);
  }
}
