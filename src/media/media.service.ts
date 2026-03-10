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
 * The result of a media hydration cycle.
 * Callers must inspect `unavailableServices` to determine whether any base
 * service fetch failed — downstream logic (e.g. snapshot orphan tracking)
 * should not penalise items from services that were temporarily unreachable.
 */
export interface HydrationResult {
  items: UnifiedMedia[];
  /** Names of base services (e.g. 'radarr', 'sonarr') that failed to respond this cycle. */
  unavailableServices: Set<string>;
}

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
   *
   * When a base service (Radarr or Sonarr) is temporarily unavailable,
   * the corresponding items are excluded from `items` but the service
   * name is added to `unavailableServices`. Callers should propagate
   * this information to the snapshot layer so that the orphan-eviction
   * counter is not incremented for items whose service was simply down.
   */
  async hydrate(rules: RuleConfig[]): Promise<HydrationResult> {
    const unavailableServices = new Set<string>();
    const neededServices = this.analyzeNeededServices(rules);
    const hasRadarrRules = rules.some(r => r.target === 'radarr');
    const hasSonarrRules = rules.some(r => r.target === 'sonarr');

    this.logger.log(
      `Hydrating media: services needed = [${[...neededServices].join(', ')}]`,
    );

    // Fetch base data from Sonarr/Radarr in parallel
    const [movies, seasons] = await Promise.all([
      hasRadarrRules
        ? this.fetchMoviesSafe(unavailableServices)
        : Promise.resolve([]),
      hasSonarrRules
        ? this.fetchSeasonsSafe(unavailableServices)
        : Promise.resolve([]),
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

    const items: UnifiedMedia[] = [...enrichedMovies, ...enrichedSeasons];

    const unavailableSuffix =
      unavailableServices.size > 0
        ? ` (unavailable: ${[...unavailableServices].join(', ')})`
        : '';
    this.logger.log(
      `Hydration complete: ${enrichedMovies.length} movies, ${enrichedSeasons.length} seasons${unavailableSuffix}`,
    );

    return { items, unavailableServices };
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

  private async fetchMoviesSafe(unavailableServices: Set<string>) {
    if (!this.radarrService) {
      this.logger.warn('Radarr service not available, skipping movie fetch');
      return [];
    }
    try {
      return await this.radarrService.fetchMovies();
    } catch (error) {
      this.logger.warn(`Radarr fetch failed, skipping: ${error}`);
      unavailableServices.add('radarr');
      return [];
    }
  }

  private async fetchSeasonsSafe(unavailableServices: Set<string>) {
    if (!this.sonarrService) {
      this.logger.warn('Sonarr service not available, skipping season fetch');
      return [];
    }
    try {
      return await this.sonarrService.fetchSeasons();
    } catch (error) {
      this.logger.warn(`Sonarr fetch failed, skipping: ${error}`);
      unavailableServices.add('sonarr');
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
