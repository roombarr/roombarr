import { Injectable, Logger } from '@nestjs/common';
import type { UnifiedSeason } from '../shared/types.js';
import { SonarrClient } from './sonarr.client.js';
import { buildTagMap, mapSeason } from './sonarr.mapper.js';

/**
 * Orchestrates Sonarr data fetching: retrieves all series and tags,
 * then expands each series into per-season unified models.
 */
@Injectable()
export class SonarrService {
  private readonly logger = new Logger(SonarrService.name);

  constructor(private readonly client: SonarrClient) {}

  /**
   * Fetch all series from Sonarr and expand into per-season unified models.
   * Season 0 (specials) is excluded since it typically isn't meaningful
   * for cleanup rules.
   */
  async fetchSeasons(): Promise<UnifiedSeason[]> {
    const [series, tags] = await Promise.all([
      this.client.fetchSeries(),
      this.client.fetchTags(),
    ]);

    const tagMap = buildTagMap(tags);
    const seasons: UnifiedSeason[] = [];

    for (const s of series) {
      for (const season of s.seasons) {
        if (season.seasonNumber === 0) continue;

        seasons.push({
          type: 'season',
          tvdb_id: s.tvdbId,
          title: `${s.title} - S${String(season.seasonNumber).padStart(2, '0')}`,
          year: s.year,
          sonarr: mapSeason(s, season, tagMap),
          jellyfin: null,
          jellyseerr: null,
        });
      }
    }

    this.logger.log(
      `Fetched ${series.length} series, expanded to ${seasons.length} seasons`,
    );
    return seasons;
  }
}
