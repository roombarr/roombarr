import type { UnifiedMedia } from '../shared/types';

/**
 * Resolves a dotted field path (e.g., "radarr.size_on_disk" or
 * "sonarr.season.episode_file_count") to its value on a unified model.
 *
 * Returns undefined if the field path can't be resolved (e.g., the
 * service data is null on the model).
 */
export function resolveField(
  item: UnifiedMedia,
  fieldPath: string,
): { value: unknown; resolved: boolean } {
  const parts = fieldPath.split('.');
  const service = parts[0];

  // Check if the service data exists on the item
  const serviceData = (item as unknown as Record<string, unknown>)[service];
  if (serviceData === null || serviceData === undefined) {
    return { value: undefined, resolved: false };
  }

  // Walk the remaining path segments
  let current: unknown = serviceData;
  for (let i = 1; i < parts.length; i++) {
    if (current === null || current === undefined) {
      return { value: undefined, resolved: false };
    }
    current = (current as Record<string, unknown>)[parts[i]];
  }

  return { value: current, resolved: true };
}
