import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type {
  JellyfinItem,
  JellyfinItemsResponse,
  JellyfinUser,
} from './jellyfin.types';

@Injectable()
export class JellyfinClient {
  private readonly logger = new Logger(JellyfinClient.name);

  constructor(private readonly http: HttpService) {}

  /**
   * Fetch all active (non-disabled) Jellyfin users.
   * Uses the isDisabled query param to filter server-side.
   */
  async fetchUsers(): Promise<JellyfinUser[]> {
    this.logger.debug('Fetching active users from Jellyfin');
    const { data } = await firstValueFrom(
      this.http.get<JellyfinUser[]>('/Users', {
        params: { isDisabled: false },
      }),
    );
    this.logger.debug(`Fetched ${data.length} active users`);
    return data;
  }

  /**
   * Fetch all played movies for a specific user.
   * Returns items with UserData attached (PlayCount, LastPlayedDate, etc).
   */
  async fetchPlayedMovies(userId: string): Promise<JellyfinItem[]> {
    this.logger.debug(`Fetching played movies for user ${userId}`);
    return this.fetchAllItems(userId, {
      IncludeItemTypes: 'Movie',
      Filters: 'IsPlayed',
      Recursive: true,
      Fields: 'ProviderIds',
    });
  }

  /**
   * Fetch all series items for a user (used to find Jellyfin series IDs
   * that match Sonarr series via TVDB ID).
   */
  async fetchSeriesItems(userId: string): Promise<JellyfinItem[]> {
    this.logger.debug(`Fetching series items for user ${userId}`);
    return this.fetchAllItems(userId, {
      IncludeItemTypes: 'Series',
      Recursive: true,
      Fields: 'ProviderIds',
    });
  }

  /**
   * Fetch all episodes for a specific season (by season's Jellyfin ID)
   * for a given user. Returns episodes with per-user UserData.
   */
  async fetchSeasonEpisodes(
    userId: string,
    seasonId: string,
  ): Promise<JellyfinItem[]> {
    this.logger.debug(
      `Fetching episodes for season ${seasonId}, user ${userId}`,
    );
    return this.fetchAllItems(userId, {
      ParentId: seasonId,
      IncludeItemTypes: 'Episode',
      Fields: 'ProviderIds',
    });
  }

  /**
   * Fetch all seasons for a specific series (by series' Jellyfin ID)
   * for a given user. Returns season items with UserData.
   */
  async fetchSeriesSeasons(
    userId: string,
    seriesId: string,
  ): Promise<JellyfinItem[]> {
    this.logger.debug(
      `Fetching seasons for series ${seriesId}, user ${userId}`,
    );
    return this.fetchAllItems(userId, {
      ParentId: seriesId,
      IncludeItemTypes: 'Season',
    });
  }

  /**
   * Paginate through all items matching the given query params.
   * Jellyfin uses startIndex/limit for pagination.
   */
  private async fetchAllItems(
    userId: string,
    params: Record<string, unknown>,
  ): Promise<JellyfinItem[]> {
    const pageSize = 100;
    const allItems: JellyfinItem[] = [];
    let startIndex = 0;

    while (true) {
      const { data } = await firstValueFrom(
        this.http.get<JellyfinItemsResponse>(`/Users/${userId}/Items`, {
          params: {
            ...params,
            StartIndex: startIndex,
            Limit: pageSize,
          },
        }),
      );

      allItems.push(...data.Items);

      if (allItems.length >= data.TotalRecordCount) break;
      startIndex += pageSize;
    }

    return allItems;
  }
}
