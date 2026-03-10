import { mock } from 'bun:test';
import type { JellyfinClient } from '../jellyfin/jellyfin.client';
import type { JellyfinItem, JellyfinUser } from '../jellyfin/jellyfin.types';
import type { JellyseerrClient } from '../jellyseerr/jellyseerr.client';
import type { JellyseerrRequest } from '../jellyseerr/jellyseerr.types';
import type { RadarrClient } from '../radarr/radarr.client';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from '../radarr/radarr.types';
import type { SonarrClient } from '../sonarr/sonarr.client';
import type {
  SonarrEpisodeFile,
  SonarrSeries,
  SonarrTag,
} from '../sonarr/sonarr.types';

/** Creates a mock `RadarrClient` with all methods stubbed. */
export function createMockRadarrClient() {
  return {
    fetchMovies: mock<() => Promise<RadarrMovie[]>>(),
    fetchMovie: mock<() => Promise<RadarrMovie>>(),
    fetchTags: mock<() => Promise<RadarrTag[]>>(),
    fetchImportListMovies: mock<() => Promise<RadarrImportListMovie[]>>(),
    deleteMovie: mock<() => Promise<void>>(),
    updateMovie: mock<() => Promise<void>>(),
  } as unknown as RadarrClient;
}

/** Creates a mock `SonarrClient` with all methods stubbed. */
export function createMockSonarrClient() {
  return {
    fetchSeries: mock<() => Promise<SonarrSeries[]>>(),
    fetchSeriesById: mock<() => Promise<SonarrSeries>>(),
    fetchTags: mock<() => Promise<SonarrTag[]>>(),
    fetchEpisodeFiles: mock<() => Promise<SonarrEpisodeFile[]>>(),
    updateSeries: mock<() => Promise<void>>(),
    deleteEpisodeFile: mock<() => Promise<void>>(),
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
