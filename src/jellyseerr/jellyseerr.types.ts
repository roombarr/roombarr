/**
 * Jellyseerr API response DTOs.
 * These represent the raw JSON shapes returned by the Jellyseerr API,
 * using camelCase field names as Jellyseerr sends them.
 */

export interface JellyseerrUser {
  id: number;
  username: string;
  email: string;
}

export interface JellyseerrMediaInfo {
  id: number;
  tmdbId: number;
  tvdbId?: number;
  mediaType: 'movie' | 'tv';
  status: number;
}

export interface JellyseerrRequest {
  id: number;
  status: number;
  type: 'movie' | 'tv';
  createdAt: string;
  media: JellyseerrMediaInfo;
  requestedBy: JellyseerrUser;
}

export interface JellyseerrPageInfo {
  page: number;
  pages: number;
  results: number;
}

/** Wrapper for paginated Jellyseerr request queries. */
export interface JellyseerrRequestsResponse {
  pageInfo: JellyseerrPageInfo;
  results: JellyseerrRequest[];
}
