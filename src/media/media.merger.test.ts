import { describe, expect, test } from 'bun:test';
import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service.js';
import {
  makeJellyfinData,
  makeJellyseerrData,
  makeMovie,
  makeSeason,
} from '../test/index.js';
import { enrichMovies, enrichSeasons } from './media.merger.js';

const jellyfinData = makeJellyfinData({
  watched_by: ['alice', 'bob'],
  watched_by_all: true,
  last_played: '2024-12-01T20:00:00Z',
  play_count: 3,
});

const jellyseerrRequestData = makeJellyseerrData();

describe('enrichMovies', () => {
  test('enriches movies with matched Jellyfin and Jellyseerr data', () => {
    const movies = [makeMovie({ tmdb_id: 603 }), makeMovie({ tmdb_id: 999 })];
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
    const movies = [makeMovie({ tmdb_id: 603 })];
    const jellyseerrIndexes: JellyseerrIndexes = {
      byTmdbId: new Map([[603, jellyseerrRequestData]]),
      byTvdbId: new Map(),
    };

    const result = enrichMovies(movies, null, jellyseerrIndexes);

    expect(result[0].jellyfin).toBeNull();
    expect(result[0].jellyseerr).toEqual(jellyseerrRequestData);
  });

  test('handles null Jellyseerr data', () => {
    const movies = [makeMovie({ tmdb_id: 603 })];
    const jellyfinMap = new Map([[603, jellyfinData]]);

    const result = enrichMovies(movies, jellyfinMap, null);

    expect(result[0].jellyfin).toEqual(jellyfinData);
    expect(result[0].jellyseerr).toBeNull();
  });

  test('handles both enrichment sources null', () => {
    const movies = [makeMovie({ tmdb_id: 603 })];
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
      makeSeason(),
      makeSeason({ sonarr: { season: { season_number: 2 } } }),
      makeSeason({ tvdb_id: 200 }),
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
    const seasons = [makeSeason()];
    const result = enrichSeasons(seasons, null, null);

    expect(result[0].jellyfin).toBeNull();
    expect(result[0].jellyseerr).toBeNull();
  });

  test('handles empty season list', () => {
    const result = enrichSeasons([], new Map(), null);
    expect(result).toEqual([]);
  });
});
