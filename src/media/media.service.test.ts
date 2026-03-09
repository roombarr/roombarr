import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RuleConfig } from '../config/config.schema.js';
import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service.js';
import type { UnifiedMovie } from '../shared/types.js';
import {
  makeJellyfinData,
  makeJellyseerrData,
  makeMovie,
  makeRule,
  makeSeason,
} from '../test/index.js';
import { MediaService } from './media.service.js';

const jellyfinMovieData = makeJellyfinData({
  last_played: '2024-12-01T20:00:00Z',
});

const jellyseerrIndexes: JellyseerrIndexes = {
  byTmdbId: new Map([[603, makeJellyseerrData()]]),
  byTvdbId: new Map(),
};

describe('MediaService', () => {
  let radarrService: { fetchMovies: ReturnType<typeof mock> };
  let sonarrService: { fetchSeasons: ReturnType<typeof mock> };
  let jellyfinService: {
    fetchMovieWatchData: ReturnType<typeof mock>;
    fetchSeasonWatchData: ReturnType<typeof mock>;
  };
  let jellyseerrService: { fetchRequestData: ReturnType<typeof mock> };
  let service: MediaService;

  beforeEach(() => {
    radarrService = {
      fetchMovies: mock(() => Promise.resolve([makeMovie({ tmdb_id: 603 })])),
    };
    sonarrService = {
      fetchSeasons: mock(() => Promise.resolve([makeSeason()])),
    };
    jellyfinService = {
      fetchMovieWatchData: mock(() =>
        Promise.resolve(new Map([[603, jellyfinMovieData]])),
      ),
      fetchSeasonWatchData: mock(() => Promise.resolve(new Map())),
    };
    jellyseerrService = {
      fetchRequestData: mock(() => Promise.resolve(jellyseerrIndexes)),
    };

    service = new MediaService(
      sonarrService as any,
      radarrService as any,
      jellyfinService as any,
      jellyseerrService as any,
    );
  });

  test('fetches and merges movies with enrichment data', async () => {
    const rules: RuleConfig[] = [
      makeRule({
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'jellyfin.watched_by_all',
              operator: 'equals',
              value: true,
            },
            {
              field: 'jellyseerr.request_status',
              operator: 'equals',
              value: 'approved',
            },
          ],
        },
      }),
    ];

    const result = await service.hydrate(rules);

    expect(result).toHaveLength(1);
    const movie = result[0] as UnifiedMovie;
    expect(movie.jellyfin).toEqual(jellyfinMovieData);
    expect(movie.jellyseerr?.requested_by).toBe('alice');
    expect(radarrService.fetchMovies).toHaveBeenCalledTimes(1);
    expect(jellyfinService.fetchMovieWatchData).toHaveBeenCalledTimes(1);
    expect(jellyseerrService.fetchRequestData).toHaveBeenCalledTimes(1);
  });

  test('skips Jellyfin fetch when no rules reference jellyfin fields', async () => {
    const rules: RuleConfig[] = [
      makeRule({
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    await service.hydrate(rules);

    expect(jellyfinService.fetchMovieWatchData).not.toHaveBeenCalled();
    expect(jellyfinService.fetchSeasonWatchData).not.toHaveBeenCalled();
  });

  test('skips Jellyseerr fetch when no rules reference jellyseerr fields', async () => {
    const rules: RuleConfig[] = [
      makeRule({
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    await service.hydrate(rules);

    expect(jellyseerrService.fetchRequestData).not.toHaveBeenCalled();
  });

  test('skips Sonarr fetch when no rules target sonarr', async () => {
    const rules: RuleConfig[] = [makeRule({ target: 'radarr' })];

    await service.hydrate(rules);

    expect(sonarrService.fetchSeasons).not.toHaveBeenCalled();
  });

  test('skips Radarr fetch when no rules target radarr', async () => {
    const rules: RuleConfig[] = [
      makeRule({
        target: 'sonarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'sonarr.status', operator: 'equals', value: 'ended' },
          ],
        },
      }),
    ];

    await service.hydrate(rules);

    expect(radarrService.fetchMovies).not.toHaveBeenCalled();
  });

  test('handles null services gracefully', async () => {
    const serviceWithNulls = new MediaService(null, null, null, null);
    const rules: RuleConfig[] = [makeRule()];

    const result = await serviceWithNulls.hydrate(rules);

    expect(result).toEqual([]);
  });

  test('handles service fetch failure gracefully', async () => {
    radarrService.fetchMovies = mock(() =>
      Promise.reject(new Error('Connection refused')),
    );

    const rules: RuleConfig[] = [makeRule()];
    const result = await service.hydrate(rules);

    // Should return empty instead of throwing
    const movies = result.filter(r => r.type === 'movie');
    expect(movies).toHaveLength(0);
  });

  test('handles Jellyfin failure gracefully while still returning base data', async () => {
    jellyfinService.fetchMovieWatchData = mock(() =>
      Promise.reject(new Error('Jellyfin offline')),
    );

    const rules: RuleConfig[] = [
      makeRule({
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'jellyfin.watched_by_all',
              operator: 'equals',
              value: true,
            },
          ],
        },
      }),
    ];

    const result = await service.hydrate(rules);

    // Movies should still be present, just without Jellyfin enrichment
    expect(result).toHaveLength(1);
    expect(result[0].jellyfin).toBeNull();
  });

  test('fetches both movies and seasons when both targets present', async () => {
    const rules: RuleConfig[] = [
      makeRule({ target: 'radarr' }),
      makeRule({
        target: 'sonarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'sonarr.status', operator: 'equals', value: 'ended' },
          ],
        },
      }),
    ];

    const result = await service.hydrate(rules);

    expect(result).toHaveLength(2);
    expect(radarrService.fetchMovies).toHaveBeenCalledTimes(1);
    expect(sonarrService.fetchSeasons).toHaveBeenCalledTimes(1);
  });
});
