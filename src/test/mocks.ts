import { mock } from 'bun:test';
import type { JellyfinClient } from '../jellyfin/jellyfin.client.js';
import type { JellyfinItem, JellyfinUser } from '../jellyfin/jellyfin.types.js';
import type { JellyseerrClient } from '../jellyseerr/jellyseerr.client.js';
import type { JellyseerrRequest } from '../jellyseerr/jellyseerr.types.js';
import type { RadarrClient } from '../radarr/radarr.client.js';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from '../radarr/radarr.types.js';
import type { SonarrClient } from '../sonarr/sonarr.client.js';
import type { SonarrSeries, SonarrTag } from '../sonarr/sonarr.types.js';

/** Creates a mock `RadarrClient` with all fetch methods stubbed. */
export function createMockRadarrClient() {
  return {
    fetchMovies: mock<() => Promise<RadarrMovie[]>>(),
    fetchTags: mock<() => Promise<RadarrTag[]>>(),
    fetchImportListMovies: mock<() => Promise<RadarrImportListMovie[]>>(),
  } as unknown as RadarrClient;
}

/** Creates a mock `SonarrClient` with all fetch methods stubbed. */
export function createMockSonarrClient() {
  return {
    fetchSeries: mock<() => Promise<SonarrSeries[]>>(),
    fetchTags: mock<() => Promise<SonarrTag[]>>(),
  } as unknown as SonarrClient;
}

/** Creates a mock `JellyfinClient` with all fetch methods stubbed. */
export function createMockJellyfinClient() {
  return {
    fetchUsers: mock<() => Promise<JellyfinUser[]>>(),
    fetchPlayedMovies: mock<() => Promise<JellyfinItem[]>>(),
    fetchSeriesItems: mock<() => Promise<JellyfinItem[]>>(),
    fetchSeriesSeasons: mock<() => Promise<JellyfinItem[]>>(),
    fetchSeasonEpisodes: mock<() => Promise<JellyfinItem[]>>(),
  } as unknown as JellyfinClient;
}

/** Creates a mock `JellyseerrClient` with all fetch methods stubbed. */
export function createMockJellyseerrClient() {
  return {
    fetchAllRequests: mock<() => Promise<JellyseerrRequest[]>>(),
  } as unknown as JellyseerrClient;
}
