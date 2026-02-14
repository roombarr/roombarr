import { Injectable, Logger } from '@nestjs/common';
import type { JellyseerrData } from '../shared/types.js';
import { JellyseerrClient } from './jellyseerr.client.js';
import { mapRequest } from './jellyseerr.mapper.js';

/**
 * Orchestrates Jellyseerr data fetching: retrieves all requests and
 * builds dual indexes by TMDB ID and TVDB ID for efficient lookup
 * during cross-service merging.
 */
@Injectable()
export class JellyseerrService {
  private readonly logger = new Logger(JellyseerrService.name);

  constructor(private readonly client: JellyseerrClient) {}

  /**
   * Fetch all requests and build lookup indexes.
   * Returns separate maps for movie requests (keyed by TMDB ID)
   * and TV requests (keyed by TVDB ID).
   */
  async fetchRequestData(): Promise<JellyseerrIndexes> {
    const requests = await this.client.fetchAllRequests();

    const byTmdbId = new Map<number, JellyseerrData>();
    const byTvdbId = new Map<number, JellyseerrData>();

    for (const request of requests) {
      const mapped = mapRequest(request);

      if (request.type === 'movie') {
        byTmdbId.set(request.media.tmdbId, mapped);
      } else if (request.type === 'tv' && request.media.tvdbId !== undefined) {
        byTvdbId.set(request.media.tvdbId, mapped);
      }
    }

    this.logger.log(
      `Indexed ${byTmdbId.size} movie requests (TMDB) and ${byTvdbId.size} TV requests (TVDB)`,
    );

    return { byTmdbId, byTvdbId };
  }
}

export interface JellyseerrIndexes {
  byTmdbId: Map<number, JellyseerrData>;
  byTvdbId: Map<number, JellyseerrData>;
}
