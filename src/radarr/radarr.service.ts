import { Injectable, Logger } from '@nestjs/common';
import type { UnifiedMovie } from '../shared/types';
import { SnapshotService } from '../snapshot/snapshot.service';
import { RadarrClient } from './radarr.client';
import { buildImportListIndex, buildTagMap, mapMovie } from './radarr.mapper';
import type { RadarrMovie } from './radarr.types';

/**
 * Where this run's import-list membership came from.
 *
 * `held` means the live request failed and the index is each movie's last
 * snapshotted membership. A movie absent from a held index has no recorded
 * membership, so its membership is unknown rather than "on no list".
 */
type ImportListMembership =
  | { source: 'fetched'; index: Map<number, number[]> }
  | { source: 'held'; index: Map<number, number[]>; error: unknown };

/**
 * Orchestrates Radarr data fetching: retrieves all movies and tags,
 * then maps each movie to a unified model.
 */
@Injectable()
export class RadarrService {
  private readonly logger = new Logger(RadarrService.name);

  constructor(
    private readonly client: RadarrClient,
    private readonly snapshotService: SnapshotService,
  ) {}

  /**
   * Fetch every Radarr movie mapped to the unified model.
   *
   * If the import-list request fails, each movie holds its last recorded
   * membership, and movies with none recorded are left out of the run so no
   * list-based keep rule lapses because of the outage.
   */
  async fetchMovies(): Promise<UnifiedMovie[]> {
    const [movies, tags, membership] = await Promise.all([
      this.client.fetchMovies(),
      this.client.fetchTags(),
      this.fetchImportListMembership(),
    ]);

    const tagMap = buildTagMap(tags);
    const evaluable = this.withKnownMembership(movies, membership);

    const unified = evaluable.map(movie => ({
      type: 'movie' as const,
      radarr_id: movie.id,
      tmdb_id: movie.tmdbId,
      imdb_id: movie.imdbId,
      title: movie.title,
      year: movie.year,
      radarr: mapMovie(movie, tagMap, membership.index),
      jellyfin: null,
      jellyseerr: null,
      state: null,
      snapshot: null,
    }));

    this.logger.log(`Fetched and mapped ${unified.length} movies`);
    return unified;
  }

  /**
   * A failed request means membership is unknown, not that every list is
   * empty. Falling back to an empty index would lapse every list-based keep
   * rule at once, so the last snapshotted membership is held instead.
   */
  private async fetchImportListMembership(): Promise<ImportListMembership> {
    try {
      const importListMovies = await this.client.fetchImportListMovies();
      return {
        source: 'fetched',
        index: buildImportListIndex(importListMovies),
      };
    } catch (error) {
      return {
        source: 'held',
        index: this.snapshotService.lastRecordedImportListMembership(),
        error,
      };
    }
  }

  /** Drop movies whose membership is unknown because none was recorded. */
  private withKnownMembership(
    movies: RadarrMovie[],
    membership: ImportListMembership,
  ): RadarrMovie[] {
    if (membership.source === 'fetched') return movies;

    const known = movies.filter(movie => membership.index.has(movie.tmdbId));
    this.logger.error(
      `Failed to fetch import list movies; holding each movie's last recorded import-list membership for this run and skipping ${movies.length - known.length} movies with none recorded: ${membership.error}`,
    );
    return known;
  }
}
