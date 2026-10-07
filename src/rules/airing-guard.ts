import type { UnifiedMedia } from '../shared/types';
import type { GuardSkip } from './types';

/**
 * Decide whether a resolved delete must be skipped because the season may
 * still be airing. A Sonarr delete unmonitors the season, so deleting one
 * that is airing silently stops Sonarr grabbing its new episodes.
 *
 * Fails safe: a season Sonarr sent no statistics for is treated as airing.
 * Movies and seasons with nothing scheduled are never guarded; recently
 * finished seasons are left to keep rules.
 *
 * @returns The skip to record, or `null` when the delete may proceed.
 * @see docs/adr/0002-delete-skips-airing-seasons.md
 */
export function checkAiringGuard(item: UnifiedMedia): GuardSkip | null {
  if (item.type !== 'season') return null;

  const { season } = item.sonarr;

  if (season.statistics === 'missing') {
    return {
      guard: 'protect_airing_seasons',
      reason:
        'protect_airing_seasons: Sonarr sent no statistics for this season, so its airing status is unknown',
    };
  }

  if (season.next_airing === null) return null;

  return {
    guard: 'protect_airing_seasons',
    reason: `protect_airing_seasons: next episode is scheduled for ${season.next_airing}`,
  };
}
