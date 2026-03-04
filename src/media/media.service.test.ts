import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RuleConfig } from '../config/config.schema.js';
import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service.js';
import type {
  JellyfinData,
  UnifiedMovie,
  UnifiedSeason,
} from '../shared/types.js';
import { MediaService } from './media.service.js';

function makeMovie(tmdbId: number): UnifiedMovie {
  return {
    type: 'movie',
    tmdb_id: tmdbId,
    imdb_id: `tt${tmdbId}`,
    title: `Movie ${tmdbId}`,
    year: 2024,
    radarr: {
      added: '2024-06-01T12:00:00Z',
      size_on_disk: 5_000_000_000,
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

function makeSeason(tvdbId: number, seasonNumber: number): UnifiedSeason {
  return {
    type: 'season',
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
        size_on_disk: 10_000_000_000,
      },
    },
    jellyfin: null,
    jellyseerr: null,
    state: null,
  };
}

const jellyfinMovieData: JellyfinData = {
  watched_by: ['alice'],
  watched_by_all: false,
  last_played: '2024-12-01T20:00:00Z',
  play_count: 1,
};

const jellyseerrIndexes: JellyseerrIndexes = {
  byTmdbId: new Map([
    [
      603,
      {
        requested_by: 'alice',
        requested_at: '2024-01-15T12:00:00Z',
        request_status: 'approved',
      },
    ],
  ]),
  byTvdbId: new Map(),
};

function makeRule(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return {
    name: 'Test rule',
    target: 'radarr',
    action: 'delete',
    conditions: {
      operator: 'AND',
      children: [
        { field: 'radarr.monitored', operator: 'equals', value: true },
      ],
    },
    ...overrides,
  };
}

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
      fetchMovies: mock(() => Promise.resolve([makeMovie(603)])),
    };
    sonarrService = {
      fetchSeasons: mock(() => Promise.resolve([makeSeason(100, 1)])),
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
