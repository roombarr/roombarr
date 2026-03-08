import { Injectable, Logger } from '@nestjs/common';
import type { RoombarrConfig } from '../config/config.schema.js';
import type { FieldDefinition } from '../config/field-registry.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import { collectUnconfiguredFieldErrors } from '../integration/validation-utils.js';
import type {
  UnifiedMedia,
  UnifiedMovie,
  UnifiedSeason,
} from '../shared/types.js';
import { jellyfinFields } from './jellyfin.fields.js';
import type { SeasonIdentifier } from './jellyfin.service.js';
import { JellyfinService } from './jellyfin.service.js';

@Injectable()
export class JellyfinProvider implements IntegrationProvider {
  readonly name = 'jellyfin';

  private readonly logger = new Logger(JellyfinProvider.name);

  constructor(private readonly jellyfinService: JellyfinService) {}

  getFieldDefinitions(): Record<string, FieldDefinition> {
    return jellyfinFields;
  }

  validateConfig(config: RoombarrConfig): string[] {
    if (config.services.jellyfin) return [];

    const errors: string[] = [];

    for (const rule of config.rules) {
      collectUnconfiguredFieldErrors(
        rule.conditions,
        'jellyfin.',
        rule.name,
        'jellyfin',
        errors,
      );
    }

    return errors;
  }

  async enrichMedia(items: UnifiedMedia[]): Promise<UnifiedMedia[]> {
    const movies = items.filter((i): i is UnifiedMovie => i.type === 'movie');
    const seasons = items.filter(
      (i): i is UnifiedSeason => i.type === 'season',
    );

    const [movieData, seasonData] = await Promise.all([
      movies.length > 0
        ? this.fetchMovieWatchDataSafe()
        : Promise.resolve(null),
      seasons.length > 0
        ? this.fetchSeasonWatchDataSafe(seasons)
        : Promise.resolve(null),
    ]);

    return items.map(item => {
      if (item.type === 'movie') {
        return {
          ...item,
          jellyfin: movieData?.get(item.tmdb_id) ?? null,
        };
      }

      const key = `${item.tvdb_id}:${item.sonarr.season.season_number}`;
      return {
        ...item,
        jellyfin: seasonData?.get(key) ?? null,
      };
    });
  }

  private async fetchMovieWatchDataSafe() {
    try {
      return await this.jellyfinService.fetchMovieWatchData();
    } catch (error) {
      this.logger.warn(`Jellyfin movie fetch failed, skipping: ${error}`);
      return null;
    }
  }

  private async fetchSeasonWatchDataSafe(seasons: UnifiedSeason[]) {
    try {
      const identifiers: SeasonIdentifier[] = seasons.map(s => ({
        tvdbId: s.tvdb_id,
        seasonNumber: s.sonarr.season.season_number,
      }));
      return await this.jellyfinService.fetchSeasonWatchData(identifiers);
    } catch (error) {
      this.logger.warn(`Jellyfin season fetch failed, skipping: ${error}`);
      return null;
    }
  }
}
