import type { RoombarrConfig, RuleConfig } from '../config/config.schema';
import type {
  JellyfinData,
  JellyseerrData,
  RadarrData,
  SonarrData,
  UnifiedMovie,
  UnifiedSeason,
} from '../shared/types';

/** Override type for `makeMovie` — allows partial radarr sub-object merging. */
export type MovieOverrides = Partial<
  Omit<UnifiedMovie, 'type' | 'radarr'> & { radarr?: Partial<RadarrData> }
>;

/** Override type for `makeSeason` — allows partial sonarr and sonarr.season merging. */
export type SeasonOverrides = Partial<
  Omit<UnifiedSeason, 'type' | 'sonarr'> & {
    sonarr?: Partial<
      Omit<SonarrData, 'season'> & { season?: Partial<SonarrData['season']> }
    >;
  }
>;

const defaultRadarr: RadarrData = {
  added: '2024-01-01T00:00:00Z',
  size_on_disk: 5_000_000_000,
  has_file: true,
  monitored: true,
  tags: [],
  genres: ['Action'],
  status: 'released',
  year: 2024,
  digital_release: null,
  physical_release: null,
  path: '/movies/test',
  on_import_list: false,
  import_list_ids: [],
};

const defaultSonarrSeason: SonarrData['season'] = {
  season_number: 1,
  monitored: true,
  episode_count: 10,
  episode_file_count: 10,
  has_file: true,
  size_on_disk: 10_000_000_000,
};

const defaultSonarr: SonarrData = {
  tags: [],
  genres: ['Drama'],
  status: 'ended',
  year: 2023,
  path: '/tv/test',
  season: defaultSonarrSeason,
};

/**
 * Creates a `UnifiedMovie` with sensible defaults.
 * Deep-merges `radarr` one level so callers can override individual fields.
 */
export function makeMovie(overrides: MovieOverrides = {}): UnifiedMovie {
  const { radarr: radarrOverrides, ...topLevel } = overrides;

  return {
    type: 'movie',
    radarr_id: 101,
    tmdb_id: 1,
    imdb_id: 'tt0000001',
    title: 'Test Movie',
    year: 2024,
    jellyfin: null,
    jellyseerr: null,
    state: null,
    ...topLevel,
    radarr: { ...defaultRadarr, ...radarrOverrides },
  };
}

/**
 * Creates a `UnifiedSeason` with sensible defaults.
 * Deep-merges `sonarr` fields and `sonarr.season` fields separately
 * so callers can override at either level without replacing the whole object.
 */
export function makeSeason(overrides: SeasonOverrides = {}): UnifiedSeason {
  const { sonarr: sonarrOverrides, ...topLevel } = overrides;
  const { season: seasonOverrides, ...sonarrTopLevel } = sonarrOverrides ?? {};

  return {
    type: 'season',
    sonarr_series_id: 201,
    tvdb_id: 100,
    title: 'Test Show - S01',
    year: 2023,
    jellyfin: null,
    jellyseerr: null,
    state: null,
    ...topLevel,
    sonarr: {
      ...defaultSonarr,
      ...sonarrTopLevel,
      season: { ...defaultSonarrSeason, ...seasonOverrides },
    },
  };
}

/** Creates a `JellyfinData` with sensible defaults for testing. */
export function makeJellyfinData(
  overrides: Partial<JellyfinData> = {},
): JellyfinData {
  return {
    watched_by: ['Alice'],
    watched_by_all: false,
    last_played: '2024-06-01T00:00:00Z',
    play_count: 1,
    ...overrides,
  };
}

/** Creates a `JellyseerrData` with sensible defaults for testing. */
export function makeJellyseerrData(
  overrides: Partial<JellyseerrData> = {},
): JellyseerrData {
  return {
    requested_by: 'alice',
    requested_at: '2024-01-15T12:00:00Z',
    request_status: 'approved',
    ...overrides,
  };
}

/**
 * Creates a `RuleConfig` with sensible defaults.
 * Conditions are typically replaced wholesale, so this uses a simple top-level spread.
 */
export function makeRule(overrides: Partial<RuleConfig> = {}): RuleConfig {
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

/**
 * Creates a `RoombarrConfig` with sensible defaults.
 * All four services are configured, dry_run is enabled, and one default rule is included.
 */
export function makeConfig(
  overrides: Partial<RoombarrConfig> = {},
): RoombarrConfig {
  return {
    dry_run: true,
    services: {
      sonarr: { base_url: 'http://sonarr:8989', api_key: 'sonarr-key' },
      radarr: { base_url: 'http://radarr:7878', api_key: 'radarr-key' },
      jellyfin: { base_url: 'http://jellyfin:8096', api_key: 'jellyfin-key' },
      jellyseerr: {
        base_url: 'http://jellyseerr:5055',
        api_key: 'jellyseerr-key',
      },
    },
    schedule: '0 3 * * *',
    performance: { concurrency: 10 },
    audit: { retention_days: 90 },
    rules: [makeRule()],
    ...overrides,
  };
}
