import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { SonarrSeries, SonarrTag } from './sonarr.types.js';

@Injectable()
export class SonarrClient {
  private readonly logger = new Logger(SonarrClient.name);

  constructor(private readonly http: HttpService) {}

  async fetchSeries(): Promise<SonarrSeries[]> {
    this.logger.debug('Fetching all series from Sonarr');
    const { data } = await firstValueFrom(
      this.http.get<SonarrSeries[]>('/api/v3/series'),
    );
    this.logger.debug(`Fetched ${data.length} series`);
    return data;
  }

  async fetchTags(): Promise<SonarrTag[]> {
    this.logger.debug('Fetching tags from Sonarr');
    const { data } = await firstValueFrom(
      this.http.get<SonarrTag[]>('/api/v3/tag'),
    );
    this.logger.debug(`Fetched ${data.length} tags`);
    return data;
  }
}
