/**
 * Sonarr v3 API response DTOs.
 * These represent the raw JSON shapes returned by the Sonarr API,
 * using camelCase field names as Sonarr sends them.
 */

export interface SonarrSeasonStatistics {
  episodeCount: number;
  episodeFileCount: number;
  sizeOnDisk: number;
  totalEpisodeCount: number;
  percentOfEpisodes: number;
  /** ISO timestamp of the next scheduled episode. Absent or null when none is scheduled. */
  nextAiring?: string | null;
  /** ISO timestamp of the most recently aired episode. Absent or null when none has aired. */
  previousAiring?: string | null;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: SonarrSeasonStatistics;
}

export interface SonarrSeries {
  id: number;
  title: string;
  tvdbId: number;
  imdbId: string | null;
  year: number;
  path: string;
  status: string;
  genres: string[];
  tags: number[];
  monitored: boolean;
  seasons: SonarrSeason[];
}

export interface SonarrTag {
  id: number;
  label: string;
}

export interface SonarrEpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  path: string;
  size: number;
}
