import type { JellyfinData } from '../shared/types.js';

/**
 * Per-user watch record for a single media item.
 * Collected from querying each user's played items.
 */
export interface UserWatchRecord {
  username: string;
  playCount: number;
  lastPlayedDate: string | null;
}

/**
 * Aggregate movie watch data across all users into a JellyfinData object.
 *
 * @param records - One record per user who has watched the movie
 * @param totalActiveUsers - Total number of active Jellyfin users
 */
export function aggregateMovieWatchData(
  records: UserWatchRecord[],
  totalActiveUsers: number,
): JellyfinData {
  const watchedBy = records.map(r => r.username);
  const playCount = records.reduce((sum, r) => sum + r.playCount, 0);
  const lastPlayed = latestDate(records.map(r => r.lastPlayedDate));

  return {
    watched_by: watchedBy,
    watched_by_all:
      watchedBy.length >= totalActiveUsers && totalActiveUsers > 0,
    last_played: lastPlayed,
    play_count: playCount,
  };
}

/**
 * Per-user episode watch data for a single season.
 * Each entry represents one user's watch status across all episodes.
 */
export interface UserSeasonEpisodeData {
  username: string;
  episodes: Array<{
    played: boolean;
    playCount: number;
    lastPlayedDate: string | null;
  }>;
}

/**
 * Aggregate season-level watch data from episode-level per-user data.
 *
 * A user counts as having "watched" a season only if they've played
 * ALL episodes in that season. Play count for the season is computed
 * as the minimum play count across episodes (then summed across users).
 * Last played is the maximum LastPlayedDate across all episodes and users.
 *
 * @param userEpisodeData - Per-user episode data for the season
 * @param totalActiveUsers - Total number of active Jellyfin users
 */
export function aggregateSeasonWatchData(
  userEpisodeData: UserSeasonEpisodeData[],
  totalActiveUsers: number,
): JellyfinData {
  const watchedBy: string[] = [];
  let totalPlayCount = 0;
  const allDates: Array<string | null> = [];

  for (const userData of userEpisodeData) {
    if (userData.episodes.length === 0) continue;

    const allPlayed = userData.episodes.every(ep => ep.played);
    if (allPlayed) {
      watchedBy.push(userData.username);
    }

    // Min play count across episodes for this user
    const minPlayCount = Math.min(...userData.episodes.map(ep => ep.playCount));
    totalPlayCount += minPlayCount;

    // Collect all dates for global max
    for (const ep of userData.episodes) {
      allDates.push(ep.lastPlayedDate);
    }
  }

  return {
    watched_by: watchedBy,
    watched_by_all:
      watchedBy.length >= totalActiveUsers && totalActiveUsers > 0,
    last_played: latestDate(allDates),
    play_count: totalPlayCount,
  };
}

/**
 * Find the most recent non-null date from an array of ISO date strings.
 * Returns null if all dates are null/undefined.
 */
function latestDate(dates: Array<string | null | undefined>): string | null {
  let latest: string | null = null;

  for (const date of dates) {
    if (!date) continue;
    if (!latest || date > latest) {
      latest = date;
    }
  }

  return latest;
}
