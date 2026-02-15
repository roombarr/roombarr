import { Injectable, Logger } from '@nestjs/common';
import type { UnifiedMovie } from '../shared/types.js';
import { RadarrClient } from './radarr.client.js';
import {
  buildImportListIndex,
  buildTagMap,
  mapMovie,
} from './radarr.mapper.js';

/**
 * Orchestrates Radarr data fetching: retrieves all movies and tags,
 * then maps each movie to a unified model.
 */
@Injectable()
export class RadarrService {
  private readonly logger = new Logger(RadarrService.name);

  constructor(private readonly client: RadarrClient) {}

  async fetchMovies(): Promise<UnifiedMovie[]> {
    const [movies, tags, importListMovies] = await Promise.all([
      this.client.fetchMovies(),
      this.client.fetchTags(),
      this.client.fetchImportListMovies().catch(error => {
        this.logger.warn(
          `Failed to fetch import list movies, skipping: ${error}`,
        );
        return [];
      }),
    ]);

    const tagMap = buildTagMap(tags);
    const importListIndex = buildImportListIndex(importListMovies);

    const unified = movies.map(movie => ({
      type: 'movie' as const,
      tmdb_id: movie.tmdbId,
      imdb_id: movie.imdbId,
      title: movie.title,
      year: movie.year,
      radarr: mapMovie(movie, tagMap, importListIndex),
      jellyfin: null,
      jellyseerr: null,
      state: null,
    }));

    this.logger.log(`Fetched and mapped ${unified.length} movies`);
    return unified;
  }
}
