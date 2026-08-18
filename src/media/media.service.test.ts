import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RuleConfig } from '../config/config.schema';
import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service';
import type { UnifiedMovie } from '../shared/types';
import {
  makeJellyfinData,
  makeJellyseerrData,
  makeMovie,
  makeRule,
  makeSeason,
} from '../test/index';
import { MediaService } from './media.service';

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

  test('fails when a required base service is unavailable', async () => {
    const serviceWithNulls = new MediaService(null, null, null, null);
    const rules: RuleConfig[] = [makeRule()];

    await expect(serviceWithNulls.hydrate(rules)).rejects.toThrow(
      'Radarr service is required by configured rules',
    );
  });

  test('fails when Sonarr rules are configured without Sonarr', async () => {
    const serviceWithoutSonarr = new MediaService(
      null,
      radarrService as any,
      null,
      null,
    );
    const rules: RuleConfig[] = [makeRule({ target: 'sonarr' })];

    await expect(serviceWithoutSonarr.hydrate(rules)).rejects.toThrow(
      'Sonarr service is required by configured rules',
    );
  });

  test('propagates a Radarr base-data fetch failure', async () => {
    radarrService.fetchMovies = mock(() =>
      Promise.reject(new Error('Connection refused')),
    );

    const rules: RuleConfig[] = [makeRule()];
    await expect(service.hydrate(rules)).rejects.toThrow('Connection refused');
  });

  test('propagates a Sonarr base-data fetch failure', async () => {
    sonarrService.fetchSeasons = mock(() =>
      Promise.reject(new Error('Sonarr unreachable')),
    );

    const rules: RuleConfig[] = [makeRule({ target: 'sonarr' })];
    await expect(service.hydrate(rules)).rejects.toThrow('Sonarr unreachable');
  });

  test('propagates a Jellyfin movie fetch failure instead of degrading', async () => {
    // Swallowing this would leave every movie with jellyfin: null, which is
    // indistinguishable from "nobody watched it" — silently dropping the keep
    // rules that protect the library.
    jellyfinService.fetchMovieWatchData = mock(() =>
      Promise.reject(new Error('Jellyfin unreachable')),
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

    await expect(service.hydrate(rules)).rejects.toThrow(
      'Jellyfin unreachable',
    );
  });

  test('propagates a Jellyseerr fetch failure instead of degrading', async () => {
    jellyseerrService.fetchRequestData = mock(() =>
      Promise.reject(new Error('Jellyseerr unreachable')),
    );

    const rules: RuleConfig[] = [
      makeRule({
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'jellyseerr.request_status',
              operator: 'equals',
              value: 'approved',
            },
          ],
        },
      }),
    ];

    await expect(service.hydrate(rules)).rejects.toThrow(
      'Jellyseerr unreachable',
    );
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
