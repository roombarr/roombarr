import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from './radarr.types.js';

@Injectable()
export class RadarrClient {
  private readonly logger = new Logger(RadarrClient.name);

  constructor(private readonly http: HttpService) {}

  async fetchMovies(): Promise<RadarrMovie[]> {
    this.logger.debug('Fetching all movies from Radarr');
    const { data } = await firstValueFrom(
      this.http.get<RadarrMovie[]>('/api/v3/movie'),
    );
    this.logger.debug(`Fetched ${data.length} movies`);
    return data;
  }

  async fetchTags(): Promise<RadarrTag[]> {
    this.logger.debug('Fetching tags from Radarr');
    const { data } = await firstValueFrom(
      this.http.get<RadarrTag[]>('/api/v3/tag'),
    );
    this.logger.debug(`Fetched ${data.length} tags`);
    return data;
  }

  async fetchImportListMovies(): Promise<RadarrImportListMovie[]> {
    this.logger.debug('Fetching import list movies from Radarr');
    const { data } = await firstValueFrom(
      this.http.get<RadarrImportListMovie[]>('/api/v3/importlist/movie'),
    );
    this.logger.debug(`Fetched ${data.length} import list movies`);
    return data;
  }
}
