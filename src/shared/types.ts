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
  /** Series status as Sonarr sent it. Null when Sonarr sent none. */
  status: string | null;
  year: number;
  path: string;
  season: SonarrSeasonData;
}

/**
 * Season air dates, keyed on whether Sonarr reported statistics at all.
 * "No statistics" means the airing status is unknown, which is not the same
 * as "statistics with nothing scheduled" — the airing-season guard treats
 * unknown as airing.
 */
export type SonarrSeasonAiring =
  | {
      statistics: 'reported';
      /** Next scheduled episode. Null when nothing is scheduled. */
      next_airing: string | null;
      /** Most recently aired episode. Null when nothing has aired. */
      previous_airing: string | null;
    }
  | {
      statistics: 'missing';
      next_airing: null;
      previous_airing: null;
    };

export type SonarrSeasonData = {
  season_number: number;
  monitored: boolean;
  episode_count: number;
  episode_file_count: number;
  has_file: boolean;
  size_on_disk: number;
} & SonarrSeasonAiring;

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

export interface SnapshotData {
  first_seen_at: string;
}

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
  snapshot: SnapshotData | null;
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
  snapshot: SnapshotData | null;
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
