import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from './radarr.types';

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

  async fetchMovie(movieId: number): Promise<RadarrMovie> {
    this.logger.debug(`Fetching movie ${movieId} from Radarr`);
    const { data } = await firstValueFrom(
      this.http.get<RadarrMovie>(`/api/v3/movie/${movieId}`),
    );
    return data;
  }

  async deleteMovie(movieId: number, deleteFiles = true): Promise<void> {
    this.logger.debug(
      `Deleting movie ${movieId} (deleteFiles: ${deleteFiles})`,
    );
    await firstValueFrom(
      this.http.delete(`/api/v3/movie/${movieId}`, {
        params: { deleteFiles },
      }),
    );
  }

  async updateMovie(movieId: number, body: RadarrMovie): Promise<void> {
    this.logger.debug(`Updating movie ${movieId}`);
    await firstValueFrom(this.http.put(`/api/v3/movie/${movieId}`, body));
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
