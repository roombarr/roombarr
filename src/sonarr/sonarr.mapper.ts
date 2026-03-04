import type { SonarrData } from '../shared/types.js';
import type { SonarrSeason, SonarrSeries, SonarrTag } from './sonarr.types.js';

/**
 * Build a tag ID → name lookup map from the Sonarr tag list.
 * Tag labels are lowercased for consistent comparison.
 */
export function buildTagMap(tags: SonarrTag[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const tag of tags) {
    map.set(tag.id, tag.label.toLowerCase());
  }
  return map;
}

/** Resolve an array of tag IDs to their human-readable names. */
export function resolveTagNames(
  tagIds: number[],
  tagMap: Map<number, string>,
): string[] {
  return tagIds
    .map(id => tagMap.get(id))
    .filter((name): name is string => name !== undefined);
}

/**
 * Map a Sonarr series + one of its seasons into the SonarrData
 * shape used by the unified model.
 */
export function mapSeason(
  series: SonarrSeries,
  season: SonarrSeason,
  tagMap: Map<number, string>,
): SonarrData {
  const stats = season.statistics;
  return {
    tags: resolveTagNames(series.tags, tagMap),
    genres: series.genres,
    status: series.status,
    year: series.year,
    path: series.path,
    season: {
      season_number: season.seasonNumber,
      monitored: season.monitored,
      episode_count: stats?.episodeCount ?? 0,
      episode_file_count: stats?.episodeFileCount ?? 0,
      has_file: (stats?.episodeFileCount ?? 0) > 0,
      size_on_disk: stats?.sizeOnDisk ?? 0,
    },
  };
}
