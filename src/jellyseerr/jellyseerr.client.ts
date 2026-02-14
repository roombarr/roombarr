import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type {
  JellyseerrRequest,
  JellyseerrRequestsResponse,
} from './jellyseerr.types.js';

@Injectable()
export class JellyseerrClient {
  private readonly logger = new Logger(JellyseerrClient.name);

  constructor(private readonly http: HttpService) {}

  /**
   * Fetch all media requests from Jellyseerr, paginating through
   * all pages using skip/take parameters.
   */
  async fetchAllRequests(): Promise<JellyseerrRequest[]> {
    const pageSize = 50;
    const allRequests: JellyseerrRequest[] = [];
    let skip = 0;

    while (true) {
      this.logger.debug(`Fetching requests: skip=${skip}, take=${pageSize}`);

      const { data } = await firstValueFrom(
        this.http.get<JellyseerrRequestsResponse>('/api/v1/request', {
          params: {
            skip,
            take: pageSize,
            sort: 'added',
            filter: 'all',
          },
        }),
      );

      allRequests.push(...data.results);

      const { page, pages } = data.pageInfo;
      if (page >= pages) break;
      skip += pageSize;
    }

    this.logger.debug(`Fetched ${allRequests.length} total requests`);
    return allRequests;
  }
}
