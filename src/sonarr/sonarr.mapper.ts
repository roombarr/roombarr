import { z } from 'zod';
import type { SonarrData, SonarrSeasonAiring } from '../shared/types';
import type {
  SonarrSeason,
  SonarrSeasonStatistics,
  SonarrSeries,
  SonarrTag,
} from './sonarr.types';

const airDateSchema = z.iso
  .datetime({ offset: true })
  .nullish()
  .transform(value => value ?? null);

const seasonAirDatesSchema = z.object({
  nextAiring: airDateSchema,
  previousAiring: airDateSchema,
});

const UNKNOWN_AIRING: SonarrSeasonAiring = {
  statistics: 'missing',
  next_airing: null,
  previous_airing: null,
};

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
      ...mapAiring(stats),
    },
  };
}

/**
 * Validate the season's air dates at the Sonarr boundary. Statistics that are
 * absent or carry an unparseable date are reported as missing, so the airing
 * status reads as unknown rather than as "nothing scheduled".
 */
function mapAiring(
  stats: SonarrSeasonStatistics | undefined,
): SonarrSeasonAiring {
  if (!stats) return UNKNOWN_AIRING;

  const parsed = seasonAirDatesSchema.safeParse(stats);
  if (!parsed.success) return UNKNOWN_AIRING;

  return {
    statistics: 'reported',
    next_airing: parsed.data.nextAiring,
    previous_airing: parsed.data.previousAiring,
  };
}
