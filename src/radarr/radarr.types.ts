/**
 * Radarr v3 API response DTOs.
 * These represent the raw JSON shapes returned by the Radarr API,
 * using camelCase field names as Radarr sends them.
 */

export interface RadarrMovie {
  id: number;
  title: string;
  tmdbId: number;
  imdbId: string | null;
  year: number;
  path: string;
  status: string;
  genres: string[];
  tags: number[];
  monitored: boolean;
  hasFile: boolean;
  sizeOnDisk: number;
  added: string;
  digitalRelease: string | null;
  physicalRelease: string | null;
}

export interface RadarrTag {
  id: number;
  label: string;
}

/** Response from GET /api/v3/importlist/movie */
export interface RadarrImportListMovie {
  tmdbId: number;
  lists: number[];
  title: string;
  isExisting: boolean;
}

/** An import list as configured in Radarr (`GET /api/v3/importlist`). */
export interface ConfiguredImportList {
  id: number;
  name: string;
  /** The user's enable toggle. A list Radarr paused itself stays enabled. */
  enabled: boolean;
}
