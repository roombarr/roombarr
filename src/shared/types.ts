/**
 * Unified media models that merge data from all configured services.
 * These are the structures that rules evaluate against.
 */

export interface RadarrData {
  added: string;
  size_on_disk: number;
  monitored: boolean;
  tags: string[];
  genres: string[];
  status: string;
  year: number;
  has_file: boolean;
  digital_release: string | null;
  physical_release: string | null;
  path: string;
  on_import_list: boolean;
  import_list_ids: number[];
}

export interface SonarrData {
  tags: string[];
  genres: string[];
  status: string;
  year: number;
  path: string;
  season: {
    season_number: number;
    monitored: boolean;
    episode_count: number;
    episode_file_count: number;
    size_on_disk: number;
  };
}

export interface JellyfinData {
  watched_by: string[];
  watched_by_all: boolean;
  last_played: string | null;
  play_count: number;
}

export interface JellyseerrData {
  requested_by: string;
  requested_at: string;
  request_status: string;
}

export interface StateData {
  days_off_import_list: number | null;
  ever_on_import_list: boolean;
}

export interface UnifiedMovie {
  type: 'movie';
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  year: number;
  radarr: RadarrData;
  jellyfin: JellyfinData | null;
  jellyseerr: JellyseerrData | null;
  state: StateData | null;
}

export interface UnifiedSeason {
  type: 'season';
  tvdb_id: number;
  title: string;
  year: number;
  sonarr: SonarrData;
  jellyfin: JellyfinData | null;
  jellyseerr: JellyseerrData | null;
  state: StateData | null;
}

export type UnifiedMedia = UnifiedMovie | UnifiedSeason;
