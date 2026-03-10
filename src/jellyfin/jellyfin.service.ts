import { Injectable, Logger } from '@nestjs/common';
import pLimit from 'p-limit';
import type { JellyfinData } from '../shared/types';
import {
  aggregateMovieWatchData,
  aggregateSeasonWatchData,
  type UserSeasonEpisodeData,
  type UserWatchRecord,
} from './jellyfin.aggregator';
import { JellyfinClient } from './jellyfin.client';
import type { JellyfinItem, JellyfinUser } from './jellyfin.types';

/**
 * Identifies a Sonarr season for cross-referencing with Jellyfin.
 * The TVDB ID links a Sonarr series to its Jellyfin counterpart.
 */
export interface SeasonIdentifier {
  tvdbId: number;
  seasonNumber: number;
}

/**
 * Orchestrates Jellyfin data fetching: enumerates users, fetches watch data
 * for movies and seasons, and aggregates into JellyfinData objects.
 *
 * All external API calls are bounded by the configured concurrency limit
 * to avoid overwhelming the Jellyfin server.
 */
@Injectable()
export class JellyfinService {
  private readonly logger = new Logger(JellyfinService.name);

  constructor(
    private readonly client: JellyfinClient,
    private readonly concurrency: number,
  ) {}

  /**
   * Fetch movie watch data for all active users, aggregated per movie.
   * Returns a Map keyed by TMDB ID (as number).
   */
  async fetchMovieWatchData(): Promise<Map<number, JellyfinData>> {
    const users = await this.client.fetchUsers();
    const limit = pLimit(this.concurrency);

    // Fetch played movies for each user in parallel (bounded)
    const userMovies = await Promise.all(
      users.map(user => limit(() => this.client.fetchPlayedMovies(user.Id))),
    );

    // Index: TMDB ID → UserWatchRecord[]
    const movieRecords = new Map<number, UserWatchRecord[]>();

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const movies = userMovies[i];

      for (const movie of movies) {
        const tmdbId = parseTmdbId(movie);
        if (tmdbId === null) continue;

        let records = movieRecords.get(tmdbId);
        if (!records) {
          records = [];
          movieRecords.set(tmdbId, records);
        }

        records.push({
          username: user.Name,
          playCount: movie.UserData?.PlayCount ?? 0,
          lastPlayedDate: movie.UserData?.LastPlayedDate ?? null,
        });
      }
    }

    // Aggregate each movie's records
    const result = new Map<number, JellyfinData>();
    for (const [tmdbId, records] of movieRecords) {
      result.set(tmdbId, aggregateMovieWatchData(records, users.length));
    }

    this.logger.log(
      `Aggregated movie watch data: ${result.size} movies from ${users.length} users`,
    );
    return result;
  }

  /**
   * Fetch season-level watch data for the given Sonarr seasons.
   * Returns a Map keyed by `${tvdbId}:${seasonNumber}` for efficient lookup.
   *
   * This is the expensive path — requires querying episodes per season per user.
   * All API calls are bounded by the concurrency limit.
   */
  async fetchSeasonWatchData(
    seasons: SeasonIdentifier[],
  ): Promise<Map<string, JellyfinData>> {
    const users = await this.client.fetchUsers();
    if (users.length === 0) {
      this.logger.warn('No active Jellyfin users found');
      return new Map();
    }

    const limit = pLimit(this.concurrency);

    // Step 1: Find Jellyfin series for each unique TVDB ID.
    // Use first user to enumerate series (series list is the same for all users).
    const uniqueTvdbIds = [...new Set(seasons.map(s => s.tvdbId))];
    const tvdbToJellyfinSeries = await this.resolveSeriesMapping(
      users[0],
      uniqueTvdbIds,
      limit,
    );

    // Step 2: For each matched series, fetch seasons from Jellyfin
    // to get the Jellyfin season IDs (needed for episode queries).
    const seasonJellyfinIds = await this.resolveSeasonIds(
      users[0],
      tvdbToJellyfinSeries,
      seasons,
      limit,
    );

    // Step 3: For each season × user, fetch episodes and build aggregation data.
    const result = new Map<string, JellyfinData>();

    const tasks: Array<{
      key: string;
      jellyfinSeasonId: string;
    }> = [];

    for (const season of seasons) {
      const key = seasonKey(season.tvdbId, season.seasonNumber);
      const jellyfinSeasonId = seasonJellyfinIds.get(key);
      if (!jellyfinSeasonId) {
        this.logger.debug(
          `No Jellyfin match for TVDB ${season.tvdbId} S${String(season.seasonNumber).padStart(2, '0')}`,
        );
        continue;
      }
      tasks.push({ key, jellyfinSeasonId });
    }

    // Fetch episode data for all seasons × users in parallel
    for (const task of tasks) {
      const userEpisodeData: UserSeasonEpisodeData[] = await Promise.all(
        users.map(user =>
          limit(async () => {
            const episodes = await this.client.fetchSeasonEpisodes(
              user.Id,
              task.jellyfinSeasonId,
            );
            return {
              username: user.Name,
              episodes: episodes.map(ep => ({
                played: ep.UserData?.Played ?? false,
                playCount: ep.UserData?.PlayCount ?? 0,
                lastPlayedDate: ep.UserData?.LastPlayedDate ?? null,
              })),
            };
          }),
        ),
      );

      result.set(
        task.key,
        aggregateSeasonWatchData(userEpisodeData, users.length),
      );
    }

    this.logger.log(
      `Aggregated season watch data: ${result.size} seasons from ${users.length} users`,
    );
    return result;
  }

  /**
   * Map TVDB IDs to Jellyfin series IDs by querying the first user's
   * series library and matching on ProviderIds.Tvdb.
   */
  private async resolveSeriesMapping(
    user: JellyfinUser,
    tvdbIds: number[],
    limit: ReturnType<typeof pLimit>,
  ): Promise<Map<number, string>> {
    const seriesItems = await limit(() =>
      this.client.fetchSeriesItems(user.Id),
    );

    const tvdbToJellyfin = new Map<number, string>();
    const tvdbIdSet = new Set(tvdbIds);

    for (const item of seriesItems) {
      const tvdb = parseTvdbId(item);
      if (tvdb !== null && tvdbIdSet.has(tvdb)) {
        tvdbToJellyfin.set(tvdb, item.Id);
      }
    }

    this.logger.debug(
      `Resolved ${tvdbToJellyfin.size}/${tvdbIds.length} series from TVDB→Jellyfin`,
    );
    return tvdbToJellyfin;
  }

  /**
   * For each target season, find its Jellyfin season ID by querying
   * the seasons of the matched Jellyfin series.
   */
  private async resolveSeasonIds(
    user: JellyfinUser,
    tvdbToJellyfinSeries: Map<number, string>,
    seasons: SeasonIdentifier[],
    limit: ReturnType<typeof pLimit>,
  ): Promise<Map<string, string>> {
    // Group seasons by TVDB ID to avoid redundant series-season fetches
    const byTvdb = new Map<number, number[]>();
    for (const s of seasons) {
      let nums = byTvdb.get(s.tvdbId);
      if (!nums) {
        nums = [];
        byTvdb.set(s.tvdbId, nums);
      }
      nums.push(s.seasonNumber);
    }

    const result = new Map<string, string>();

    // Fetch seasons for each matched series in parallel
    const entries = [...byTvdb.entries()].filter(([tvdbId]) =>
      tvdbToJellyfinSeries.has(tvdbId),
    );

    const seasonFetches = await Promise.all(
      entries.map(([tvdbId]) => {
        const jellyfinSeriesId = tvdbToJellyfinSeries.get(tvdbId) as string;
        return limit(async () => {
          const jellyfinSeasons = await this.client.fetchSeriesSeasons(
            user.Id,
            jellyfinSeriesId,
          );
          return { tvdbId, jellyfinSeasons };
        });
      }),
    );

    for (const { tvdbId, jellyfinSeasons } of seasonFetches) {
      const targetNums = new Set(byTvdb.get(tvdbId) ?? []);
      for (const jSeason of jellyfinSeasons) {
        if (
          jSeason.IndexNumber !== undefined &&
          targetNums.has(jSeason.IndexNumber)
        ) {
          result.set(seasonKey(tvdbId, jSeason.IndexNumber), jSeason.Id);
        }
      }
    }

    this.logger.debug(`Resolved ${result.size} Jellyfin season IDs`);
    return result;
  }
}

/** Composite key for season lookup: `tvdbId:seasonNumber` */
export function seasonKey(tvdbId: number, seasonNumber: number): string {
  return `${tvdbId}:${seasonNumber}`;
}

function parseTmdbId(item: JellyfinItem): number | null {
  const raw = item.ProviderIds?.Tmdb;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseTvdbId(item: JellyfinItem): number | null {
  const raw = item.ProviderIds?.Tvdb;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
