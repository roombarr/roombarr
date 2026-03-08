import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RuleConfig } from '../config/config.schema.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import type {
  JellyfinData,
  UnifiedMedia,
  UnifiedMovie,
  UnifiedSeason,
} from '../shared/types.js';
import { MediaService } from './media.service.js';

function makeMovie(tmdbId: number): UnifiedMovie {
  return {
    type: 'movie',
    radarr_id: tmdbId + 1000,
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

function makeSeason(tvdbId: number, seasonNumber: number): UnifiedSeason {
  return {
    type: 'season',
    sonarr_series_id: tvdbId + 2000,
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

const jellyfinMovieData: JellyfinData = {
  watched_by: ['alice'],
  watched_by_all: false,
  last_played: '2024-12-01T20:00:00Z',
  play_count: 1,
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

/** Creates a mock IntegrationProvider with the given overrides. */
function makeProvider(
  overrides: Partial<IntegrationProvider>,
): IntegrationProvider {
  return {
    name: 'unknown',
    getFieldDefinitions: () => ({}),
    validateConfig: () => [],
    ...overrides,
  };
}

describe('MediaService', () => {
  let radarrFetchMedia: ReturnType<typeof mock>;
  let sonarrFetchMedia: ReturnType<typeof mock>;
  let jellyfinEnrichMedia: ReturnType<typeof mock>;
  let jellyseerrEnrichMedia: ReturnType<typeof mock>;
  let service: MediaService;

  beforeEach(() => {
    radarrFetchMedia = mock(() => Promise.resolve([makeMovie(603)]));
    sonarrFetchMedia = mock(() => Promise.resolve([makeSeason(100, 1)]));

    jellyfinEnrichMedia = mock((items: UnifiedMedia[]) =>
      Promise.resolve(
        items.map(item => {
          if (item.type === 'movie') {
            return { ...item, jellyfin: jellyfinMovieData };
          }
          return item;
        }),
      ),
    );

    jellyseerrEnrichMedia = mock((items: UnifiedMedia[]) =>
      Promise.resolve(
        items.map(item => {
          if (item.type === 'movie') {
            return {
              ...item,
              jellyseerr: {
                requested_by: 'alice',
                requested_at: '2024-01-15T12:00:00Z',
                request_status: 'approved' as const,
              },
            };
          }
          return item;
        }),
      ),
    );

    const radarrProvider = makeProvider({
      name: 'radarr',
      fetchMedia: radarrFetchMedia,
    });

    const sonarrProvider = makeProvider({
      name: 'sonarr',
      fetchMedia: sonarrFetchMedia,
    });

    const jellyfinProvider = makeProvider({
      name: 'jellyfin',
      enrichMedia: jellyfinEnrichMedia,
    });

    const jellyseerrProvider = makeProvider({
      name: 'jellyseerr',
      enrichMedia: jellyseerrEnrichMedia,
    });

    service = new MediaService([
      radarrProvider,
      sonarrProvider,
      jellyfinProvider,
      jellyseerrProvider,
    ]);
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
    expect(radarrFetchMedia).toHaveBeenCalledTimes(1);
    expect(jellyfinEnrichMedia).toHaveBeenCalledTimes(1);
    expect(jellyseerrEnrichMedia).toHaveBeenCalledTimes(1);
  });

  test('skips Jellyfin enrichment when no rules reference jellyfin fields', async () => {
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

    expect(jellyfinEnrichMedia).not.toHaveBeenCalled();
  });

  test('skips Jellyseerr enrichment when no rules reference jellyseerr fields', async () => {
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

    expect(jellyseerrEnrichMedia).not.toHaveBeenCalled();
  });

  test('skips Sonarr fetch when no rules target sonarr', async () => {
    const rules: RuleConfig[] = [makeRule({ target: 'radarr' })];

    await service.hydrate(rules);

    expect(sonarrFetchMedia).not.toHaveBeenCalled();
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

    expect(radarrFetchMedia).not.toHaveBeenCalled();
  });

  test('handles no providers gracefully', async () => {
    const emptyService = new MediaService([]);
    const rules: RuleConfig[] = [makeRule()];

    const result = await emptyService.hydrate(rules);

    expect(result).toEqual([]);
  });

  test('handles provider fetch failure gracefully', async () => {
    radarrFetchMedia.mockImplementation(() =>
      Promise.reject(new Error('Connection refused')),
    );

    const rules: RuleConfig[] = [makeRule()];
    const result = await service.hydrate(rules);

    // MediaService catches fetch failures and returns [] per provider
    const movies = result.filter(r => r.type === 'movie');
    expect(movies).toHaveLength(0);
  });

  test('handles enrichment failure gracefully while still returning base data', async () => {
    jellyfinEnrichMedia.mockImplementation(() =>
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
    expect(radarrFetchMedia).toHaveBeenCalledTimes(1);
    expect(sonarrFetchMedia).toHaveBeenCalledTimes(1);
  });
});
