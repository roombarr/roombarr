/**
 * Jellyfin API response DTOs.
 * These represent the raw JSON shapes returned by the Jellyfin API.
 */

export interface JellyfinUser {
  Id: string;
  Name: string;
  Policy: {
    IsDisabled: boolean;
  };
}

export interface JellyfinProviderIds {
  Tmdb?: string;
  Tvdb?: string;
  Imdb?: string;
}

export interface JellyfinUserData {
  PlayCount: number;
  Played: boolean;
  LastPlayedDate?: string;
  IsFavorite: boolean;
}

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  ProviderIds: JellyfinProviderIds;
  UserData?: JellyfinUserData;
  /** Present on episodes — identifies the parent season */
  ParentIndexNumber?: number;
  /** Present on episodes — the episode number within the season */
  IndexNumber?: number;
  /** Present on series/seasons — the season number */
  SeriesId?: string;
}

/**
 * Wrapper for paginated Jellyfin item queries.
 * Jellyfin returns items inside a `BaseItemDtoQueryResult`.
 */
export interface JellyfinItemsResponse {
  Items: JellyfinItem[];
  TotalRecordCount: number;
}
