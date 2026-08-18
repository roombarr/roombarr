import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import type { Action } from '../config/config.schema';
import { ConfigService } from '../config/config.service';
import { RadarrClient } from '../radarr/radarr.client';
import type { EvaluationItemResult } from '../rules/types';
import {
  buildInternalId,
  type UnifiedMedia,
  type UnifiedMovie,
  type UnifiedSeason,
} from '../shared/types';
import { SonarrClient } from '../sonarr/sonarr.client';
import type { ExecutionSummary } from './execution.types';

@Injectable()
export class ActionExecutorService {
  private readonly logger = new Logger(ActionExecutorService.name);

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly sonarrClient: SonarrClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Execute resolved actions against Radarr/Sonarr.
   * In dry-run mode, every result is marked as 'skipped' with no API calls.
   * In live mode, each actionable item is executed sequentially.
   *
   * @param isAbandoned polled before each action. Executing a queue of deletes
   * can outlive the evaluation's deadline, and once that passes the scheduler
   * is free to start another run — so the caller gets a say in stopping.
   */
  async execute(
    results: EvaluationItemResult[],
    items: UnifiedMedia[],
    dryRun: boolean,
    isAbandoned?: () => boolean,
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

    const { max_deletes_per_run } = this.configService.getConfig().safety;
    const deleteCount = results.filter(
      r => r.resolved_action === 'delete',
    ).length;

    // A rule change or upstream data shift can unprotect a large share of the
    // library at once. Refusing the whole run is recoverable; deleting it is not.
    if (max_deletes_per_run !== null && deleteCount > max_deletes_per_run) {
      this.logger.error(
        `Aborting execution: ${deleteCount} deletes resolved, exceeding safety.max_deletes_per_run (${max_deletes_per_run}). ` +
          'No actions were executed. Review the pending deletions, then either raise the limit or correct the rules.',
      );

      return {
        results: results.map(r => ({
          ...r,
          execution_status: 'skipped' as const,
        })),
        executionSummary: {
          actions_executed: { keep: 0, unmonitor: 0, delete: 0 },
          actions_failed: 0,
          aborted_reason: 'max_deletes_per_run_exceeded',
        },
      };
    }

    const itemsByInternalId = new Map(
      items.map(item => [buildInternalId(item), item]),
    );

    const executed: EvaluationItemResult[] = [];
    const counts: Record<Action, number> = { keep: 0, unmonitor: 0, delete: 0 };
    let failedCount = 0;

    for (const [index, result] of results.entries()) {
      // The deadline can elapse mid-queue. Everything still pending belongs to
      // a run that has already been written off, so stop here rather than
      // deleting against a library another evaluation may now be acting on.
      if (isAbandoned?.()) {
        this.logger.error(
          `Execution stopped after ${index} of ${results.length} results: the evaluation exceeded its deadline mid-run. ` +
            `${counts.delete} deletes, ${counts.unmonitor} unmonitors already executed; the rest were skipped.`,
        );

        for (const pending of results.slice(index)) {
          executed.push({ ...pending, execution_status: 'skipped' });
        }

        return {
          results: executed,
          executionSummary: {
            actions_executed: counts,
            actions_failed: failedCount,
            aborted_reason: 'evaluation_abandoned',
          },
        };
      }

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
          executed.push({ ...result, execution_status: 'not_found' });
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
    switch (action) {
      case 'delete':
        return item.type === 'movie'
          ? this.deleteMovie(item)
          : this.deleteSeasonFiles(item);
      case 'unmonitor':
        return item.type === 'movie'
          ? this.unmonitorMovie(item)
          : this.unmonitorSeason(item);
      case 'keep':
        return;
      default:
        throw new Error(`Unknown action: ${action satisfies never}`);
    }
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

    let deletedCount = 0;
    let alreadyRemovedCount = 0;

    for (const file of seasonFiles) {
      try {
        await this.sonarrClient.deleteEpisodeFile(file.id);
        deletedCount++;
      } catch (error) {
        if (this.isNotFound(error)) {
          this.logger.warn(
            `Episode file ${file.id} for "${season.title}" S${String(seasonNumber).padStart(2, '0')}: 404 — already removed`,
          );
          alreadyRemovedCount++;
          continue;
        }
        throw error;
      }
    }

    const parts = [`Deleted ${deletedCount} episode files`];
    if (alreadyRemovedCount > 0)
      parts.push(`${alreadyRemovedCount} already removed`);
    this.logger.log(
      `${parts.join(', ')} for "${season.title}" S${String(seasonNumber).padStart(2, '0')}`,
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
