import { Injectable, Logger } from '@nestjs/common';
import type { UnifiedSeason } from '../shared/types';
import { SonarrClient } from './sonarr.client';
import { buildTagMap, mapSeason } from './sonarr.mapper';

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

        const sonarr = mapSeason(s, season, tagMap);

        // The mapper drops statistics whose air dates don't parse, which makes
        // the airing-season guard skip deletes. Say why, so it isn't a mystery.
        if (season.statistics && sonarr.season.statistics === 'missing') {
          this.logger.warn(
            `Sonarr sent an unparseable air date for "${s.title}" S${String(season.seasonNumber).padStart(2, '0')}; treating its airing status as unknown`,
          );
        }

        seasons.push({
          type: 'season',
          sonarr_series_id: s.id,
          tvdb_id: s.tvdbId,
          title: `${s.title} - S${String(season.seasonNumber).padStart(2, '0')}`,
          year: s.year,
          sonarr,
          jellyfin: null,
          jellyseerr: null,
          state: null,
          snapshot: null,
        });
      }
    }

    this.logger.log(
      `Fetched ${series.length} series, expanded to ${seasons.length} seasons`,
    );
    return seasons;
  }
}
