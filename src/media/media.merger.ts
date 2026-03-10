import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service';
import type {
  JellyfinData,
  UnifiedMovie,
  UnifiedSeason,
} from '../shared/types';

/**
 * Enrich unified movies with Jellyfin and Jellyseerr data.
 * Matches by TMDB ID. Items without a cross-service match
 * retain their null defaults.
 */
export function enrichMovies(
  movies: UnifiedMovie[],
  jellyfinData: Map<number, JellyfinData> | null,
  jellyseerrData: JellyseerrIndexes | null,
): UnifiedMovie[] {
  return movies.map(movie => ({
    ...movie,
    jellyfin: jellyfinData?.get(movie.tmdb_id) ?? null,
    jellyseerr: jellyseerrData?.byTmdbId.get(movie.tmdb_id) ?? null,
  }));
}

/**
 * Enrich unified seasons with Jellyfin and Jellyseerr data.
 * Jellyfin matches by composite key `${tvdbId}:${seasonNumber}`.
 * Jellyseerr matches by TVDB ID (series-level, shared across seasons).
 */
export function enrichSeasons(
  seasons: UnifiedSeason[],
  jellyfinData: Map<string, JellyfinData> | null,
  jellyseerrData: JellyseerrIndexes | null,
): UnifiedSeason[] {
  return seasons.map(season => {
    const jellyfinKey = `${season.tvdb_id}:${season.sonarr.season.season_number}`;

    return {
      ...season,
      jellyfin: jellyfinData?.get(jellyfinKey) ?? null,
      jellyseerr: jellyseerrData?.byTvdbId.get(season.tvdb_id) ?? null,
    };
  });
}
