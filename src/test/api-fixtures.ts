import type { JellyfinItem, JellyfinUser } from '../jellyfin/jellyfin.types.js';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from '../radarr/radarr.types.js';
import type {
  SonarrEpisodeFile,
  SonarrSeries,
  SonarrTag,
} from '../sonarr/sonarr.types.js';

/** Creates a `RadarrMovie` with sensible defaults for testing. */
export function makeRadarrMovie(
  overrides: Partial<RadarrMovie> = {},
): RadarrMovie {
  return {
    id: 1,
    title: 'Test Movie',
    tmdbId: 100,
    imdbId: 'tt0000100',
    year: 2024,
    path: '/movies/test-movie',
    status: 'released',
    genres: ['action'],
    tags: [],
    monitored: true,
    hasFile: true,
    sizeOnDisk: 5_000_000_000,
    added: '2024-06-01T12:00:00Z',
    digitalRelease: null,
    physicalRelease: null,
    ...overrides,
  };
}

/** Creates a `RadarrTag` with sensible defaults for testing. */
export function makeRadarrTag(overrides: Partial<RadarrTag> = {}): RadarrTag {
  return { id: 1, label: 'test-tag', ...overrides };
}

/** Creates a `RadarrImportListMovie` with sensible defaults for testing. */
export function makeRadarrImportListMovie(
  overrides: Partial<RadarrImportListMovie> = {},
): RadarrImportListMovie {
  return {
    tmdbId: 100,
    lists: [1],
    title: 'Test Movie',
    isExisting: true,
    ...overrides,
  };
}

/** Creates a `SonarrSeries` with sensible defaults for testing. */
export function makeSonarrSeries(
  overrides: Partial<SonarrSeries> = {},
): SonarrSeries {
  return {
    id: 1,
    title: 'Test Series',
    tvdbId: 500,
    imdbId: 'tt0000500',
    year: 2023,
    path: '/tv/test-series',
    status: 'continuing',
    genres: ['drama'],
    tags: [],
    monitored: true,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ],
    ...overrides,
  };
}

/** Creates a `SonarrTag` with sensible defaults for testing. */
export function makeSonarrTag(overrides: Partial<SonarrTag> = {}): SonarrTag {
  return { id: 1, label: 'test-tag', ...overrides };
}

/** Creates a `SonarrEpisodeFile` with sensible defaults for testing. */
export function makeSonarrEpisodeFile(
  overrides: Partial<SonarrEpisodeFile> = {},
): SonarrEpisodeFile {
  return {
    id: 1,
    seriesId: 1,
    seasonNumber: 1,
    path: '/tv/test-series/Season 01/episode.mkv',
    size: 1_500_000_000,
    ...overrides,
  };
}

/** Creates a `JellyfinUser` with sensible defaults for testing. */
export function makeJellyfinUser(
  overrides: Partial<JellyfinUser> = {},
): JellyfinUser {
  return {
    Id: 'user-1',
    Name: 'Test User',
    Policy: { IsDisabled: false },
    ...overrides,
  };
}

/** Creates a `JellyfinItem` with sensible defaults for testing. */
export function makeJellyfinItem(
  overrides: Partial<JellyfinItem> = {},
): JellyfinItem {
  return {
    Id: 'item-1',
    Name: 'Test Item',
    Type: 'Movie',
    ProviderIds: { Tmdb: '100' },
    ...overrides,
  };
}
