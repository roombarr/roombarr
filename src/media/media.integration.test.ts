import { describe, expect, mock, test } from 'bun:test';
import type { RuleConfig } from '../config/config.schema.js';
import { JellyfinClient } from '../jellyfin/jellyfin.client.js';
import { JellyfinService } from '../jellyfin/jellyfin.service.js';
import type { JellyfinItem, JellyfinUser } from '../jellyfin/jellyfin.types.js';
import { JellyseerrClient } from '../jellyseerr/jellyseerr.client.js';
import { JellyseerrService } from '../jellyseerr/jellyseerr.service.js';
import type { JellyseerrRequest } from '../jellyseerr/jellyseerr.types.js';
import { RadarrClient } from '../radarr/radarr.client.js';
import { RadarrService } from '../radarr/radarr.service.js';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from '../radarr/radarr.types.js';
import type { UnifiedMovie, UnifiedSeason } from '../shared/types.js';
import { SonarrClient } from '../sonarr/sonarr.client.js';
import { SonarrService } from '../sonarr/sonarr.service.js';
import type { SonarrSeries, SonarrTag } from '../sonarr/sonarr.types.js';
import { makeRule } from '../test/fixtures.js';
import { MediaService } from './media.service.js';

// ── Raw API fixture factories ──────────────────────────────────────────

function makeRadarrMovie(overrides: Partial<RadarrMovie> = {}): RadarrMovie {
  return {
    id: 1,
    title: 'Integration Movie',
    tmdbId: 550,
    imdbId: 'tt0137523',
    year: 1999,
    path: '/movies/integration-movie',
    status: 'released',
    genres: ['Drama', 'Thriller'],
    tags: [1],
    monitored: true,
    hasFile: true,
    sizeOnDisk: 8_000_000_000,
    added: '2024-06-15T12:00:00Z',
    digitalRelease: '2024-03-01T00:00:00Z',
    physicalRelease: '2024-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeRadarrTag(overrides: Partial<RadarrTag> = {}): RadarrTag {
  return { id: 1, label: 'Upgrade', ...overrides };
}

function makeImportListMovie(
  overrides: Partial<RadarrImportListMovie> = {},
): RadarrImportListMovie {
  return {
    tmdbId: 550,
    lists: [10],
    title: 'Integration Movie',
    isExisting: true,
    ...overrides,
  };
}

function makeSonarrSeries(overrides: Partial<SonarrSeries> = {}): SonarrSeries {
  return {
    id: 5,
    title: 'Integration Show',
    tvdbId: 777,
    imdbId: 'tt9999999',
    year: 2022,
    path: '/tv/integration-show',
    status: 'continuing',
    genres: ['Sci-Fi'],
    tags: [2],
    monitored: true,
    seasons: [
      {
        seasonNumber: 0,
        monitored: false,
      },
      {
        seasonNumber: 1,
        monitored: true,
        statistics: {
          episodeCount: 8,
          episodeFileCount: 8,
          sizeOnDisk: 12_000_000_000,
          totalEpisodeCount: 10,
          percentOfEpisodes: 80,
        },
      },
    ],
    ...overrides,
  };
}

function makeSonarrTag(overrides: Partial<SonarrTag> = {}): SonarrTag {
  return { id: 2, label: 'Favorite', ...overrides };
}

function makeJellyfinUser(overrides: Partial<JellyfinUser> = {}): JellyfinUser {
  return {
    Id: 'user-1',
    Name: 'alice',
    Policy: { IsDisabled: false },
    ...overrides,
  };
}

function makeMovieItem(overrides: Partial<JellyfinItem> = {}): JellyfinItem {
  return {
    Id: 'jf-movie-1',
    Name: 'Integration Movie',
    Type: 'Movie',
    ProviderIds: { Tmdb: '550' },
    UserData: {
      PlayCount: 2,
      Played: true,
      LastPlayedDate: '2025-01-10T20:00:00Z',
      IsFavorite: false,
    },
    ...overrides,
  };
}

function makeSeriesItem(overrides: Partial<JellyfinItem> = {}): JellyfinItem {
  return {
    Id: 'jf-series-1',
    Name: 'Integration Show',
    Type: 'Series',
    ProviderIds: { Tvdb: '777' },
    ...overrides,
  };
}

function makeSeasonItem(overrides: Partial<JellyfinItem> = {}): JellyfinItem {
  return {
    Id: 'jf-season-1',
    Name: 'Season 1',
    Type: 'Season',
    ProviderIds: {},
    IndexNumber: 1,
    SeriesId: 'jf-series-1',
    ...overrides,
  };
}

function makeEpisodeItem(overrides: Partial<JellyfinItem> = {}): JellyfinItem {
  return {
    Id: 'jf-ep-1',
    Name: 'Episode 1',
    Type: 'Episode',
    ProviderIds: {},
    ParentIndexNumber: 1,
    IndexNumber: 1,
    UserData: {
      PlayCount: 1,
      Played: true,
      LastPlayedDate: '2025-02-01T18:00:00Z',
      IsFavorite: false,
    },
    ...overrides,
  };
}

function makeJellyseerrRequest(
  overrides: Partial<JellyseerrRequest> = {},
): JellyseerrRequest {
  return {
    id: 42,
    status: 2,
    type: 'movie',
    createdAt: '2024-12-01T10:00:00Z',
    media: {
      id: 100,
      tmdbId: 550,
      mediaType: 'movie',
      status: 5,
    },
    requestedBy: {
      id: 1,
      username: 'bob',
      email: 'bob@example.com',
    },
    ...overrides,
  };
}

// ── Test helpers ────────────────────────────────────────────────────────

function createMockRadarrClient() {
  return {
    fetchMovies: mock<() => Promise<RadarrMovie[]>>(),
    fetchTags: mock<() => Promise<RadarrTag[]>>(),
    fetchImportListMovies: mock<() => Promise<RadarrImportListMovie[]>>(),
  } as unknown as RadarrClient;
}

function createMockSonarrClient() {
  return {
    fetchSeries: mock<() => Promise<SonarrSeries[]>>(),
    fetchTags: mock<() => Promise<SonarrTag[]>>(),
  } as unknown as SonarrClient;
}

function createMockJellyfinClient() {
  return {
    fetchUsers: mock<() => Promise<JellyfinUser[]>>(),
    fetchPlayedMovies: mock<() => Promise<JellyfinItem[]>>(),
    fetchSeriesItems: mock<() => Promise<JellyfinItem[]>>(),
    fetchSeriesSeasons: mock<() => Promise<JellyfinItem[]>>(),
    fetchSeasonEpisodes: mock<() => Promise<JellyfinItem[]>>(),
  } as unknown as JellyfinClient;
}

function createMockJellyseerrClient() {
  return {
    fetchAllRequests: mock<() => Promise<JellyseerrRequest[]>>(),
  } as unknown as JellyseerrClient;
}

// ── Integration tests ──────────────────────────────────────────────────

describe('media hydration pipeline (integration)', () => {
  test('full hydration with all 4 services — Radarr movie with Jellyfin + Jellyseerr', async () => {
    const radarrClient = createMockRadarrClient();
    const jellyfinClient = createMockJellyfinClient();
    const jellyseerrClient = createMockJellyseerrClient();

    // Configure Radarr mock responses
    (radarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue([
      makeRadarrMovie(),
    ]);
    (radarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue([
      makeRadarrTag(),
    ]);
    (
      radarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([makeImportListMovie()]);

    // Configure Jellyfin mock responses — two users, both watched
    const users = [
      makeJellyfinUser({ Id: 'user-1', Name: 'alice' }),
      makeJellyfinUser({ Id: 'user-2', Name: 'charlie' }),
    ];
    (jellyfinClient.fetchUsers as ReturnType<typeof mock>).mockResolvedValue(
      users,
    );
    (
      jellyfinClient.fetchPlayedMovies as ReturnType<typeof mock>
    ).mockImplementation((userId: string) => {
      if (userId === 'user-1') {
        return Promise.resolve([
          makeMovieItem({
            UserData: {
              PlayCount: 2,
              Played: true,
              LastPlayedDate: '2025-01-10T20:00:00Z',
              IsFavorite: false,
            },
          }),
        ]);
      }
      return Promise.resolve([
        makeMovieItem({
          UserData: {
            PlayCount: 1,
            Played: true,
            LastPlayedDate: '2025-01-05T15:00:00Z',
            IsFavorite: false,
          },
        }),
      ]);
    });

    // Configure Jellyseerr mock responses
    (
      jellyseerrClient.fetchAllRequests as ReturnType<typeof mock>
    ).mockResolvedValue([makeJellyseerrRequest()]);

    // Wire real services with mock clients
    const radarrService = new RadarrService(radarrClient);
    const jellyfinService = new JellyfinService(jellyfinClient, 5);
    const jellyseerrService = new JellyseerrService(jellyseerrClient);
    const mediaService = new MediaService(
      null,
      radarrService,
      jellyfinService,
      jellyseerrService,
    );

    // Rules reference radarr, jellyfin, and jellyseerr fields
    const rules: RuleConfig[] = [
      makeRule({
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
            {
              field: 'jellyfin.play_count',
              operator: 'greater_than',
              value: 0,
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

    const results = await mediaService.hydrate(rules);

    expect(results).toHaveLength(1);
    const movie = results[0] as UnifiedMovie;

    // Verify Radarr data was mapped correctly from raw API types
    expect(movie.type).toBe('movie');
    expect(movie.radarr_id).toBe(1);
    expect(movie.tmdb_id).toBe(550);
    expect(movie.imdb_id).toBe('tt0137523');
    expect(movie.title).toBe('Integration Movie');
    expect(movie.radarr.tags).toEqual(['upgrade']); // lowercased by buildTagMap
    expect(movie.radarr.on_import_list).toBe(true); // matched by tmdbId
    expect(movie.radarr.import_list_ids).toEqual([10]);
    expect(movie.radarr.size_on_disk).toBe(8_000_000_000);
    expect(movie.radarr.digital_release).toBe('2024-03-01T00:00:00Z');
    expect(movie.radarr.physical_release).toBe('2024-04-01T00:00:00Z');
    expect(movie.radarr.genres).toEqual(['Drama', 'Thriller']);

    // Verify Jellyfin data was aggregated correctly from raw per-user items
    expect(movie.jellyfin).not.toBeNull();
    expect(movie.jellyfin!.watched_by).toEqual(['alice', 'charlie']);
    expect(movie.jellyfin!.watched_by_all).toBe(true); // 2/2 users watched
    expect(movie.jellyfin!.play_count).toBe(3); // 2 + 1
    expect(movie.jellyfin!.last_played).toBe('2025-01-10T20:00:00Z'); // latest

    // Verify Jellyseerr data was mapped correctly from raw request
    expect(movie.jellyseerr).not.toBeNull();
    expect(movie.jellyseerr!.requested_by).toBe('bob');
    expect(movie.jellyseerr!.requested_at).toBe('2024-12-01T10:00:00Z');
    expect(movie.jellyseerr!.request_status).toBe('approved'); // status 2

    // State is null (no state service in this pipeline)
    expect(movie.state).toBeNull();
  });

  test('Radarr only — Jellyfin and Jellyseerr clients are never called', async () => {
    const radarrClient = createMockRadarrClient();
    const jellyfinClient = createMockJellyfinClient();
    const jellyseerrClient = createMockJellyseerrClient();

    (radarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue([
      makeRadarrMovie(),
    ]);
    (radarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue([
      makeRadarrTag(),
    ]);
    (
      radarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([]);

    const radarrService = new RadarrService(radarrClient);
    const jellyfinService = new JellyfinService(jellyfinClient, 5);
    const jellyseerrService = new JellyseerrService(jellyseerrClient);
    const mediaService = new MediaService(
      null,
      radarrService,
      jellyfinService,
      jellyseerrService,
    );

    // Rule only references radarr.* fields
    const rules: RuleConfig[] = [
      makeRule({
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.has_file', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    const results = await mediaService.hydrate(rules);

    expect(results).toHaveLength(1);
    const movie = results[0] as UnifiedMovie;

    // Radarr data is populated
    expect(movie.radarr.has_file).toBe(true);
    expect(movie.radarr.tags).toEqual(['upgrade']);

    // Enrichment data is null
    expect(movie.jellyfin).toBeNull();
    expect(movie.jellyseerr).toBeNull();

    // Jellyfin and Jellyseerr clients were never invoked
    expect(jellyfinClient.fetchUsers).not.toHaveBeenCalled();
    expect(jellyfinClient.fetchPlayedMovies).not.toHaveBeenCalled();
    expect(jellyseerrClient.fetchAllRequests).not.toHaveBeenCalled();
  });

  test('Sonarr + Jellyfin — season enrichment with composite key matching', async () => {
    const sonarrClient = createMockSonarrClient();
    const jellyfinClient = createMockJellyfinClient();

    // Configure Sonarr mock responses
    (sonarrClient.fetchSeries as ReturnType<typeof mock>).mockResolvedValue([
      makeSonarrSeries(),
    ]);
    (sonarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue([
      makeSonarrTag(),
    ]);

    // Configure Jellyfin mock responses for season watch data
    const users = [makeJellyfinUser({ Id: 'user-1', Name: 'alice' })];
    (jellyfinClient.fetchUsers as ReturnType<typeof mock>).mockResolvedValue(
      users,
    );
    (
      jellyfinClient.fetchSeriesItems as ReturnType<typeof mock>
    ).mockResolvedValue([makeSeriesItem()]); // TVDB 777 → jf-series-1
    (
      jellyfinClient.fetchSeriesSeasons as ReturnType<typeof mock>
    ).mockResolvedValue([makeSeasonItem()]); // Season 1 → jf-season-1
    (
      jellyfinClient.fetchSeasonEpisodes as ReturnType<typeof mock>
    ).mockResolvedValue([
      makeEpisodeItem({
        Id: 'ep-1',
        IndexNumber: 1,
        UserData: {
          PlayCount: 1,
          Played: true,
          LastPlayedDate: '2025-02-01T18:00:00Z',
          IsFavorite: false,
        },
      }),
      makeEpisodeItem({
        Id: 'ep-2',
        IndexNumber: 2,
        UserData: {
          PlayCount: 1,
          Played: true,
          LastPlayedDate: '2025-02-03T20:00:00Z',
          IsFavorite: false,
        },
      }),
    ]);

    const sonarrService = new SonarrService(sonarrClient);
    const jellyfinService = new JellyfinService(jellyfinClient, 5);
    const mediaService = new MediaService(
      sonarrService,
      null,
      jellyfinService,
      null,
    );

    // Rules reference sonarr and jellyfin fields
    const rules: RuleConfig[] = [
      makeRule({
        target: 'sonarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'sonarr.season.has_file',
              operator: 'equals',
              value: true,
            },
            {
              field: 'jellyfin.watched_by_all',
              operator: 'equals',
              value: true,
            },
          ],
        },
      }),
    ];

    const results = await mediaService.hydrate(rules);

    // Season 0 is filtered out by SonarrService, only season 1 remains
    expect(results).toHaveLength(1);
    const season = results[0] as UnifiedSeason;

    // Verify Sonarr data was mapped correctly
    expect(season.type).toBe('season');
    expect(season.sonarr_series_id).toBe(5);
    expect(season.tvdb_id).toBe(777);
    expect(season.title).toBe('Integration Show - S01');
    expect(season.sonarr.tags).toEqual(['favorite']); // lowercased
    expect(season.sonarr.genres).toEqual(['Sci-Fi']);
    expect(season.sonarr.status).toBe('continuing');
    expect(season.sonarr.season.season_number).toBe(1);
    expect(season.sonarr.season.episode_count).toBe(8);
    expect(season.sonarr.season.episode_file_count).toBe(8);
    expect(season.sonarr.season.has_file).toBe(true);
    expect(season.sonarr.season.size_on_disk).toBe(12_000_000_000);

    // Verify Jellyfin data was aggregated from episode-level data
    expect(season.jellyfin).not.toBeNull();
    expect(season.jellyfin!.watched_by).toEqual(['alice']); // all eps played
    expect(season.jellyfin!.watched_by_all).toBe(true); // 1/1 users
    expect(season.jellyfin!.play_count).toBe(1); // min(1,1) across episodes
    expect(season.jellyfin!.last_played).toBe('2025-02-03T20:00:00Z'); // latest

    // No Jellyseerr enrichment
    expect(season.jellyseerr).toBeNull();
  });

  test('movie with no matching Jellyseerr request — jellyseerr is null', async () => {
    const radarrClient = createMockRadarrClient();
    const jellyfinClient = createMockJellyfinClient();
    const jellyseerrClient = createMockJellyseerrClient();

    (radarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue([
      makeRadarrMovie({ tmdbId: 999 }), // TMDB 999
    ]);
    (radarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue([]);
    (
      radarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([]);

    // Single user with watch data for tmdbId 999
    const users = [makeJellyfinUser()];
    (jellyfinClient.fetchUsers as ReturnType<typeof mock>).mockResolvedValue(
      users,
    );
    (
      jellyfinClient.fetchPlayedMovies as ReturnType<typeof mock>
    ).mockResolvedValue([
      makeMovieItem({
        ProviderIds: { Tmdb: '999' },
        UserData: {
          PlayCount: 1,
          Played: true,
          LastPlayedDate: '2025-03-01T10:00:00Z',
          IsFavorite: false,
        },
      }),
    ]);

    // Jellyseerr has a request, but for a different TMDB ID (550, not 999)
    (
      jellyseerrClient.fetchAllRequests as ReturnType<typeof mock>
    ).mockResolvedValue([
      makeJellyseerrRequest({
        media: { id: 100, tmdbId: 550, mediaType: 'movie', status: 5 },
      }),
    ]);

    const radarrService = new RadarrService(radarrClient);
    const jellyfinService = new JellyfinService(jellyfinClient, 5);
    const jellyseerrService = new JellyseerrService(jellyseerrClient);
    const mediaService = new MediaService(
      null,
      radarrService,
      jellyfinService,
      jellyseerrService,
    );

    const rules: RuleConfig[] = [
      makeRule({
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
            {
              field: 'jellyfin.play_count',
              operator: 'greater_than',
              value: 0,
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

    const results = await mediaService.hydrate(rules);

    expect(results).toHaveLength(1);
    const movie = results[0] as UnifiedMovie;

    // Radarr data present (tags empty since no tags provided)
    expect(movie.tmdb_id).toBe(999);
    expect(movie.radarr.monitored).toBe(true);
    expect(movie.radarr.tags).toEqual([]);
    expect(movie.radarr.on_import_list).toBe(false);

    // Jellyfin data present — matched by TMDB ID 999
    expect(movie.jellyfin).not.toBeNull();
    expect(movie.jellyfin!.watched_by).toEqual(['alice']);
    expect(movie.jellyfin!.play_count).toBe(1);

    // Jellyseerr data is null — no request for TMDB ID 999
    expect(movie.jellyseerr).toBeNull();
  });
});
