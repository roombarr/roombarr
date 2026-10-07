import type { UnifiedMedia } from '../shared/types';
import type { GuardSkip } from './types';

const AIRING_STATUSES = new Set(['continuing', 'upcoming']);
const FINISHED_STATUSES = new Set(['ended', 'deleted']);

/** A series status the guard couldn't place, so it treated the series as airing. */
export type UnknownSeriesStatus =
  | { kind: 'unrecognized'; value: string }
  | { kind: 'missing' };

/**
 * How a Sonarr series status bears on whether its undated seasons may still air.
 */
type SeriesAiringStatus =
  | { kind: 'airing'; value: string }
  | { kind: 'finished' }
  | UnknownSeriesStatus;

/**
 * Classify a Sonarr series status, case-insensitively. `continuing` and
 * `upcoming` may still air; `ended` and `deleted` (removed from the metadata
 * source) won't. Anything else is unknown.
 */
function classifySeriesStatus(status: string | null): SeriesAiringStatus {
  if (status === null) return { kind: 'missing' };

  const normalized = status.toLowerCase();
  if (AIRING_STATUSES.has(normalized)) {
    return { kind: 'airing', value: normalized };
  }
  if (FINISHED_STATUSES.has(normalized)) return { kind: 'finished' };
  return { kind: 'unrecognized', value: status };
}

/**
 * A guard skip, plus the unknown series status it relied on, if any, so the
 * run can report each unknown status once.
 */
export interface AiringGuardDecision {
  skip: GuardSkip;
  unknownStatus: UnknownSeriesStatus | null;
}

const skip = (reason: string): AiringGuardDecision => ({
  skip: { guard: 'protect_airing_seasons', reason },
  unknownStatus: null,
});

/**
 * Decide whether a resolved delete must be skipped because the season may
 * still be airing. A Sonarr delete unmonitors the season, so deleting one
 * that is airing silently stops Sonarr grabbing its new episodes.
 *
 * A season is guarded when Sonarr sent no statistics for it, when it has a
 * next episode scheduled, or when nothing in it has aired yet and the series
 * may still air. That last case excludes specials (season 0), which pile up
 * undated episodes on long-running shows.
 *
 * Fails safe: missing statistics and unknown series statuses are treated as
 * airing. Movies and finished seasons are never guarded; recently finished
 * seasons are left to keep rules.
 *
 * @returns The skip to record, or `null` when the delete may proceed.
 * @see docs/adr/0002-delete-skips-airing-seasons.md
 */
export function checkAiringGuard(
  item: UnifiedMedia,
): AiringGuardDecision | null {
  if (item.type !== 'season') return null;

  const { season, status } = item.sonarr;

  if (season.statistics === 'missing') {
    return skip(
      'protect_airing_seasons: Sonarr sent no statistics for this season, so its airing status is unknown',
    );
  }

  if (season.next_airing !== null) {
    return skip(
      `protect_airing_seasons: next episode is scheduled for ${season.next_airing}`,
    );
  }

  if (season.previous_airing !== null) return null;
  if (season.season_number === 0) return null;

  const seriesStatus = classifySeriesStatus(status);
  if (seriesStatus.kind === 'finished') return null;

  if (seriesStatus.kind === 'airing') {
    return skip(
      `protect_airing_seasons: no episodes have aired yet and the series is ${seriesStatus.value}`,
    );
  }

  return {
    ...skip(
      `protect_airing_seasons: no episodes have aired yet and the series status is unknown (${describeUnknownStatus(seriesStatus)}), so it may still air`,
    ),
    unknownStatus: seriesStatus,
  };
}

/** Human-readable description of an unknown series status, for logs and reasons. */
export function describeUnknownStatus(status: UnknownSeriesStatus): string {
  return status.kind === 'missing'
    ? 'Sonarr sent no series status'
    : `Sonarr sent unrecognized series status "${status.value}"`;
}
