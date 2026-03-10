import { Injectable, Logger } from '@nestjs/common';
import type { Condition, RuleConfig } from '../config/config.schema';
import { getServiceFromField } from '../config/field-registry';
import type { SeasonIdentifier } from '../jellyfin/jellyfin.service';
import { JellyfinService } from '../jellyfin/jellyfin.service';
import type { JellyseerrIndexes } from '../jellyseerr/jellyseerr.service';
import { JellyseerrService } from '../jellyseerr/jellyseerr.service';
import { RadarrService } from '../radarr/radarr.service';
import type { JellyfinData, UnifiedMedia } from '../shared/types';
import { SonarrService } from '../sonarr/sonarr.service';
import { enrichMovies, enrichSeasons } from './media.merger';

/**
 * Orchestrates data hydration from all configured services.
 * Analyzes rules to determine which services are needed,
 * fetches data lazily (only from referenced services),
 * and merges everything into unified models for rule evaluation.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly sonarrService: SonarrService | null,
    private readonly radarrService: RadarrService | null,
    private readonly jellyfinService: JellyfinService | null,
    private readonly jellyseerrService: JellyseerrService | null,
  ) {}

  /**
   * Hydrate unified media models based on the given rules.
   * Only fetches from services that are actually referenced
   * in rule conditions (lazy fetching).
   */
  async hydrate(rules: RuleConfig[]): Promise<UnifiedMedia[]> {
    const neededServices = this.analyzeNeededServices(rules);
    const hasRadarrRules = rules.some(r => r.target === 'radarr');
    const hasSonarrRules = rules.some(r => r.target === 'sonarr');

    this.logger.log(
      `Hydrating media: services needed = [${[...neededServices].join(', ')}]`,
    );

    // Fetch base data from Sonarr/Radarr in parallel
    const [movies, seasons] = await Promise.all([
      hasRadarrRules ? this.fetchMoviesSafe() : Promise.resolve([]),
      hasSonarrRules ? this.fetchSeasonsSafe() : Promise.resolve([]),
    ]);

    // Fetch enrichment data in parallel (only if needed)
    const [jellyfinMovieData, jellyfinSeasonData, jellyseerrData] =
      await Promise.all([
        neededServices.has('jellyfin') && movies.length > 0
          ? this.fetchJellyfinMoviesSafe()
          : Promise.resolve(null),
        neededServices.has('jellyfin') && seasons.length > 0
          ? this.fetchJellyfinSeasonsSafe(seasons)
          : Promise.resolve(null),
        neededServices.has('jellyseerr')
          ? this.fetchJellyseerrSafe()
          : Promise.resolve(null),
      ]);

    // Merge enrichment data into unified models
    const enrichedMovies = enrichMovies(
      movies,
      jellyfinMovieData,
      jellyseerrData,
    );
    const enrichedSeasons = enrichSeasons(
      seasons,
      jellyfinSeasonData,
      jellyseerrData,
    );

    const allItems: UnifiedMedia[] = [...enrichedMovies, ...enrichedSeasons];

    this.logger.log(
      `Hydration complete: ${enrichedMovies.length} movies, ${enrichedSeasons.length} seasons`,
    );

    return allItems;
  }

  /**
   * Analyze all rules to determine which services are referenced
   * in their conditions. Only those services need to be queried.
   */
  private analyzeNeededServices(rules: RuleConfig[]): Set<string> {
    const services = new Set<string>();

    for (const rule of rules) {
      this.collectServicePrefixes(rule.conditions, services);
    }

    return services;
  }

  private collectServicePrefixes(
    condition: Condition,
    services: Set<string>,
  ): void {
    if ('field' in condition) {
      services.add(getServiceFromField(condition.field));
    } else if ('children' in condition) {
      for (const child of condition.children) {
        this.collectServicePrefixes(child, services);
      }
    }
  }

  private async fetchMoviesSafe() {
    if (!this.radarrService) {
      this.logger.warn('Radarr service not available, skipping movie fetch');
      return [];
    }
    try {
      return await this.radarrService.fetchMovies();
    } catch (error) {
      this.logger.warn(`Radarr fetch failed, skipping: ${error}`);
      return [];
    }
  }

  private async fetchSeasonsSafe() {
    if (!this.sonarrService) {
      this.logger.warn('Sonarr service not available, skipping season fetch');
      return [];
    }
    try {
      return await this.sonarrService.fetchSeasons();
    } catch (error) {
      this.logger.warn(`Sonarr fetch failed, skipping: ${error}`);
      return [];
    }
  }

  private async fetchJellyfinMoviesSafe(): Promise<Map<
    number,
    JellyfinData
  > | null> {
    if (!this.jellyfinService) {
      this.logger.warn(
        'Jellyfin service not available, skipping movie watch data',
      );
      return null;
    }
    try {
      return await this.jellyfinService.fetchMovieWatchData();
    } catch (error) {
      this.logger.warn(`Jellyfin movie fetch failed, skipping: ${error}`);
      return null;
    }
  }

  private async fetchJellyfinSeasonsSafe(
    seasons: Array<{
      tvdb_id: number;
      sonarr: { season: { season_number: number } };
    }>,
  ): Promise<Map<string, JellyfinData> | null> {
    if (!this.jellyfinService) {
      this.logger.warn(
        'Jellyfin service not available, skipping season watch data',
      );
      return null;
    }
    try {
      const identifiers: SeasonIdentifier[] = seasons.map(s => ({
        tvdbId: s.tvdb_id,
        seasonNumber: s.sonarr.season.season_number,
      }));
      return await this.jellyfinService.fetchSeasonWatchData(identifiers);
    } catch (error) {
      this.logger.warn(`Jellyfin season fetch failed, skipping: ${error}`);
      return null;
    }
  }

  private async fetchJellyseerrSafe(): Promise<JellyseerrIndexes | null> {
    if (!this.jellyseerrService) {
      this.logger.warn(
        'Jellyseerr service not available, skipping request data',
      );
      return null;
    }
    try {
      return await this.jellyseerrService.fetchRequestData();
    } catch (error) {
      this.logger.warn(`Jellyseerr fetch failed, skipping: ${error}`);
      return null;
    }
  }
}
