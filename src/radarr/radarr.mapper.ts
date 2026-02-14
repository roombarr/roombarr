import type { RadarrData } from '../shared/types.js';
import type { RadarrMovie, RadarrTag } from './radarr.types.js';

/**
 * Build a tag ID → name lookup map from the Radarr tag list.
 * Tag labels are lowercased for consistent comparison.
 */
export function buildTagMap(tags: RadarrTag[]): Map<number, string> {
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

/** Map a Radarr movie to the RadarrData shape used by the unified model. */
export function mapMovie(
  movie: RadarrMovie,
  tagMap: Map<number, string>,
): RadarrData {
  return {
    added: movie.added,
    size_on_disk: movie.sizeOnDisk,
    monitored: movie.monitored,
    tags: resolveTagNames(movie.tags, tagMap),
    genres: movie.genres,
    status: movie.status,
    year: movie.year,
    has_file: movie.hasFile,
    digital_release: movie.digitalRelease,
    physical_release: movie.physicalRelease,
    path: movie.path,
  };
}
