import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import type { Action } from '../config/config.schema.js';
import { RadarrClient } from '../radarr/radarr.client.js';
import type { EvaluationItemResult } from '../rules/types.js';
import {
  buildInternalId,
  type UnifiedMedia,
  type UnifiedMovie,
  type UnifiedSeason,
} from '../shared/types.js';
import { SonarrClient } from '../sonarr/sonarr.client.js';
import type { ExecutionSummary } from './execution.types.js';

@Injectable()
export class ActionExecutorService {
  private readonly logger = new Logger(ActionExecutorService.name);

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly sonarrClient: SonarrClient,
  ) {}

  /**
   * Execute resolved actions against Radarr/Sonarr.
   * In dry-run mode, every result is marked as 'skipped' with no API calls.
   * In live mode, each actionable item is executed sequentially.
   */
  async execute(
    results: EvaluationItemResult[],
    items: UnifiedMedia[],
    dryRun: boolean,
  ): Promise<{
    results: EvaluationItemResult[];
    executionSummary?: ExecutionSummary;
  }> {
    if (dryRun)
      return {
        results: results.map(r => ({
          ...r,
          execution_status: 'skipped' as const,
        })),
      };

    const itemsByInternalId = new Map(
      items.map(item => [buildInternalId(item), item]),
    );

    const executed: EvaluationItemResult[] = [];
    const counts: Record<Action, number> = { keep: 0, unmonitor: 0, delete: 0 };
    let failedCount = 0;

    for (const result of results) {
      if (!result.resolved_action || result.resolved_action === 'keep') {
        executed.push({ ...result, execution_status: 'skipped' });
        continue;
      }

      const item = itemsByInternalId.get(result.internal_id);
      if (!item) {
        executed.push({
          ...result,
          execution_status: 'failed',
          execution_error: 'Item not found in hydrated data',
        });
        failedCount++;
        continue;
      }

      try {
        await this.executeAction(item, result.resolved_action);
        executed.push({ ...result, execution_status: 'success' });
        counts[result.resolved_action]++;
      } catch (error) {
        if (this.isNotFound(error)) {
          this.logger.warn(
            `${result.resolved_action} "${result.title}": 404 — already removed`,
          );
          executed.push({ ...result, execution_status: 'success' });
          counts[result.resolved_action]++;
        } else {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Failed to ${result.resolved_action} "${result.title}": ${message}`,
          );
          executed.push({
            ...result,
            execution_status: 'failed',
            execution_error: message,
          });
          failedCount++;
        }
      }
    }

    return {
      results: executed,
      executionSummary: {
        actions_executed: counts,
        actions_failed: failedCount,
      },
    };
  }

  private async executeAction(
    item: UnifiedMedia,
    action: Action,
  ): Promise<void> {
    if (item.type === 'movie') {
      return action === 'delete'
        ? this.deleteMovie(item)
        : this.unmonitorMovie(item);
    }
    return action === 'delete'
      ? this.deleteSeasonFiles(item)
      : this.unmonitorSeason(item);
  }

  private async deleteMovie(movie: UnifiedMovie): Promise<void> {
    this.logger.log(
      `Deleting movie "${movie.title}" (radarr_id: ${movie.radarr_id})`,
    );
    await this.radarrClient.deleteMovie(movie.radarr_id);
  }

  /**
   * Unmonitor a movie by re-fetching the full resource from Radarr,
   * flipping `monitored` to false, and PUTting the full body back.
   * This avoids metadata corruption from partial request bodies.
   */
  private async unmonitorMovie(movie: UnifiedMovie): Promise<void> {
    this.logger.log(
      `Unmonitoring movie "${movie.title}" (radarr_id: ${movie.radarr_id})`,
    );
    const fresh = await this.radarrClient.fetchMovie(movie.radarr_id);
    fresh.monitored = false;
    await this.radarrClient.updateMovie(movie.radarr_id, fresh);
  }

  /**
   * Delete all episode files for a specific season.
   * Fetches episode files lazily — only when deletion is actually needed.
   */
  private async deleteSeasonFiles(season: UnifiedSeason): Promise<void> {
    const seasonNumber = season.sonarr.season.season_number;
    this.logger.log(
      `Deleting files for "${season.title}" S${String(seasonNumber).padStart(2, '0')} (series_id: ${season.sonarr_series_id})`,
    );

    const allFiles = await this.sonarrClient.fetchEpisodeFiles(
      season.sonarr_series_id,
    );
    const seasonFiles = allFiles.filter(f => f.seasonNumber === seasonNumber);

    if (seasonFiles.length === 0) {
      this.logger.warn(
        `No episode files found for "${season.title}" S${String(seasonNumber).padStart(2, '0')}`,
      );
      return;
    }

    for (const file of seasonFiles) {
      await this.sonarrClient.deleteEpisodeFile(file.id);
    }

    this.logger.log(
      `Deleted ${seasonFiles.length} episode files for "${season.title}" S${String(seasonNumber).padStart(2, '0')}`,
    );
  }

  /**
   * Unmonitor a season by re-fetching the full series from Sonarr,
   * flipping the target season's `monitored` to false, and PUTting
   * the full series body back.
   */
  private async unmonitorSeason(season: UnifiedSeason): Promise<void> {
    const seasonNumber = season.sonarr.season.season_number;
    this.logger.log(
      `Unmonitoring "${season.title}" S${String(seasonNumber).padStart(2, '0')} (series_id: ${season.sonarr_series_id})`,
    );

    const freshSeries = await this.sonarrClient.fetchSeriesById(
      season.sonarr_series_id,
    );
    const targetSeason = freshSeries.seasons.find(
      s => s.seasonNumber === seasonNumber,
    );
    if (!targetSeason) {
      throw new Error(
        `Season ${seasonNumber} not found on series ${season.sonarr_series_id}`,
      );
    }

    targetSeason.monitored = false;
    await this.sonarrClient.updateSeries(season.sonarr_series_id, freshSeries);
  }

  /** Check if an error is a 404 Not Found response from Axios. */
  private isNotFound(error: unknown): boolean {
    return error instanceof AxiosError && error.response?.status === 404;
  }
}
