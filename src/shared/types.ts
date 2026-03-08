/**
 * Unified media models that merge data from all configured services.
 * These are the structures that rules evaluate against.
 */

export interface RadarrData {
  added: string;
  size_on_disk: number;
  has_file: boolean;
  monitored: boolean;
  tags: string[];
  genres: string[];
  status: string;
  year: number;
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
    has_file: boolean;
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

export type StateData = Record<string, unknown>;

export interface UnifiedMovie {
  type: 'movie';
  radarr_id: number;
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
  sonarr_series_id: number;
  tvdb_id: number;
  title: string;
  year: number;
  sonarr: SonarrData;
  jellyfin: JellyfinData | null;
  jellyseerr: JellyseerrData | null;
  state: StateData | null;
}

export type UnifiedMedia = UnifiedMovie | UnifiedSeason;

/**
 * Builds a stable, unique key for any unified media item using internal IDs.
 * Movies key on radarr_id; seasons key on sonarr_series_id + season_number.
 */
export function buildInternalId(item: UnifiedMedia): string {
  if (item.type === 'movie') return `movie:${item.radarr_id}`;
  return `season:${item.sonarr_series_id}:${item.sonarr.season.season_number}`;
}
