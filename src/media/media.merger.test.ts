import { describe, expect, test } from 'bun:test';
import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service.js';
import type {
  JellyfinData,
  JellyseerrData,
  UnifiedMovie,
  UnifiedSeason,
} from '../shared/types.js';
import { enrichMovies, enrichSeasons } from './media.merger.js';

let nextMovieInternalId = 5000;

function makeMovie(tmdbId: number): UnifiedMovie {
  return {
    type: 'movie',
    radarr_id: nextMovieInternalId++,
    tmdb_id: tmdbId,
    imdb_id: `tt${tmdbId}`,
    title: `Movie ${tmdbId}`,
    year: 2024,
    radarr: {
      added: '2024-06-01T12:00:00Z',
      size_on_disk: 5_000_000_000,
      has_file: true,
      monitored: true,
      tags: [],
      genres: ['action'],
      status: 'released',
      year: 2024,
      digital_release: null,
      physical_release: null,
      path: `/movies/Movie ${tmdbId}`,
      on_import_list: false,
      import_list_ids: [],
    },
    state: null,
    jellyfin: null,
    jellyseerr: null,
  };
}

let nextSeasonInternalId = 8000;

function makeSeason(tvdbId: number, seasonNumber: number): UnifiedSeason {
  return {
    type: 'season',
    sonarr_series_id: nextSeasonInternalId++,
    tvdb_id: tvdbId,
    title: `Series ${tvdbId} - S${String(seasonNumber).padStart(2, '0')}`,
    year: 2024,
    sonarr: {
      tags: [],
      genres: ['drama'],
      status: 'continuing',
      year: 2024,
      path: `/tv/Series ${tvdbId}`,
      season: {
        season_number: seasonNumber,
        monitored: true,
        episode_count: 10,
        episode_file_count: 10,
        has_file: true,
        size_on_disk: 10_000_000_000,
      },
    },
    jellyfin: null,
    jellyseerr: null,
    state: null,
  };
}

const jellyfinData: JellyfinData = {
  watched_by: ['alice', 'bob'],
  watched_by_all: true,
  last_played: '2024-12-01T20:00:00Z',
  play_count: 3,
};

const jellyseerrRequestData: JellyseerrData = {
  requested_by: 'alice',
  requested_at: '2024-01-15T12:00:00Z',
  request_status: 'approved',
};

describe('enrichMovies', () => {
  test('enriches movies with matched Jellyfin and Jellyseerr data', () => {
    const movies = [makeMovie(603), makeMovie(999)];
    const jellyfinMap = new Map([[603, jellyfinData]]);
    const jellyseerrIndexes: JellyseerrIndexes = {
      byTmdbId: new Map([[603, jellyseerrRequestData]]),
      byTvdbId: new Map(),
    };

    const result = enrichMovies(movies, jellyfinMap, jellyseerrIndexes);

    expect(result[0].jellyfin).toEqual(jellyfinData);
    expect(result[0].jellyseerr).toEqual(jellyseerrRequestData);
    // Movie 999 has no matches
    expect(result[1].jellyfin).toBeNull();
    expect(result[1].jellyseerr).toBeNull();
  });

  test('handles null Jellyfin data', () => {
    const movies = [makeMovie(603)];
    const jellyseerrIndexes: JellyseerrIndexes = {
      byTmdbId: new Map([[603, jellyseerrRequestData]]),
      byTvdbId: new Map(),
    };

    const result = enrichMovies(movies, null, jellyseerrIndexes);

    expect(result[0].jellyfin).toBeNull();
    expect(result[0].jellyseerr).toEqual(jellyseerrRequestData);
  });

  test('handles null Jellyseerr data', () => {
    const movies = [makeMovie(603)];
    const jellyfinMap = new Map([[603, jellyfinData]]);

    const result = enrichMovies(movies, jellyfinMap, null);

    expect(result[0].jellyfin).toEqual(jellyfinData);
    expect(result[0].jellyseerr).toBeNull();
  });

  test('handles both enrichment sources null', () => {
    const movies = [makeMovie(603)];
    const result = enrichMovies(movies, null, null);

    expect(result[0].jellyfin).toBeNull();
    expect(result[0].jellyseerr).toBeNull();
  });

  test('handles empty movie list', () => {
    const result = enrichMovies([], new Map(), null);
    expect(result).toEqual([]);
  });
});

describe('enrichSeasons', () => {
  test('enriches seasons with matched Jellyfin and Jellyseerr data', () => {
    const seasons = [
      makeSeason(100, 1),
      makeSeason(100, 2),
      makeSeason(200, 1),
    ];
    const jellyfinMap = new Map([['100:1', jellyfinData]]);
    const jellyseerrIndexes: JellyseerrIndexes = {
      byTmdbId: new Map(),
      byTvdbId: new Map([[100, jellyseerrRequestData]]),
    };

    const result = enrichSeasons(seasons, jellyfinMap, jellyseerrIndexes);

    // Season 1 of series 100: both matched
    expect(result[0].jellyfin).toEqual(jellyfinData);
    expect(result[0].jellyseerr).toEqual(jellyseerrRequestData);
    // Season 2 of series 100: no Jellyfin match, but Jellyseerr matched (series-level)
    expect(result[1].jellyfin).toBeNull();
    expect(result[1].jellyseerr).toEqual(jellyseerrRequestData);
    // Season 1 of series 200: no matches
    expect(result[2].jellyfin).toBeNull();
    expect(result[2].jellyseerr).toBeNull();
  });

  test('handles null enrichment sources', () => {
    const seasons = [makeSeason(100, 1)];
    const result = enrichSeasons(seasons, null, null);

    expect(result[0].jellyfin).toBeNull();
    expect(result[0].jellyseerr).toBeNull();
  });

  test('handles empty season list', () => {
    const result = enrichSeasons([], new Map(), null);
    expect(result).toEqual([]);
  });
});
