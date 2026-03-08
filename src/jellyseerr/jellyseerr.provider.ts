import { Injectable, Logger } from '@nestjs/common';
import type { RoombarrConfig } from '../config/config.schema.js';
import type { FieldDefinition } from '../config/field-registry.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import { collectUnconfiguredFieldErrors } from '../integration/validation-utils.js';
import type { UnifiedMedia } from '../shared/types.js';
import { jellyseerrFields } from './jellyseerr.fields.js';
import { JellyseerrService } from './jellyseerr.service.js';

@Injectable()
export class JellyseerrProvider implements IntegrationProvider {
  readonly name = 'jellyseerr';

  private readonly logger = new Logger(JellyseerrProvider.name);

  constructor(private readonly jellyseerrService: JellyseerrService) {}

  getFieldDefinitions(): Record<string, FieldDefinition> {
    return jellyseerrFields;
  }

  validateConfig(config: RoombarrConfig): string[] {
    if (config.services.jellyseerr) return [];

    const errors: string[] = [];

    for (const rule of config.rules) {
      collectUnconfiguredFieldErrors(
        rule.conditions,
        'jellyseerr.',
        rule.name,
        'jellyseerr',
        errors,
      );
    }

    return errors;
  }

  async enrichMedia(items: UnifiedMedia[]): Promise<UnifiedMedia[]> {
    const data = await this.fetchRequestDataSafe();
    if (!data) return items;

    return items.map(item => {
      if (item.type === 'movie') {
        return {
          ...item,
          jellyseerr: data.byTmdbId.get(item.tmdb_id) ?? null,
        };
      }

      return {
        ...item,
        jellyseerr: data.byTvdbId.get(item.tvdb_id) ?? null,
      };
    });
  }

  private async fetchRequestDataSafe() {
    try {
      return await this.jellyseerrService.fetchRequestData();
    } catch (error) {
      this.logger.warn(`Jellyseerr request fetch failed, skipping: ${error}`);
      return null;
    }
  }
}
