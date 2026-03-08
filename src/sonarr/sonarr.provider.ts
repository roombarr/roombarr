import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import type { Action, RoombarrConfig } from '../config/config.schema.js';
import type { FieldDefinition } from '../config/field-registry.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import { collectUnconfiguredTargetErrors } from '../integration/validation-utils.js';
import type { UnifiedMedia, UnifiedSeason } from '../shared/types.js';
import { SonarrClient } from './sonarr.client.js';
import { sonarrFields } from './sonarr.fields.js';
import { SonarrService } from './sonarr.service.js';

@Injectable()
export class SonarrProvider implements IntegrationProvider {
  readonly name = 'sonarr';

  private readonly logger = new Logger(SonarrProvider.name);

  constructor(
    private readonly sonarrService: SonarrService,
    private readonly sonarrClient: SonarrClient,
  ) {}

  getFieldDefinitions(): Record<string, FieldDefinition> {
    return sonarrFields;
  }

  validateConfig(config: RoombarrConfig): string[] {
    return collectUnconfiguredTargetErrors(config, this.name);
  }

  async fetchMedia(): Promise<UnifiedMedia[]> {
    return this.sonarrService.fetchSeasons();
  }

  async executeAction(item: UnifiedMedia, action: Action): Promise<void> {
    if (item.type !== 'season') return;

    switch (action) {
      case 'delete':
        return this.deleteSeasonFiles(item);
      case 'unmonitor':
        return this.unmonitorSeason(item);
      case 'keep':
        return;
    }
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
