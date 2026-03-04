import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type {
  SonarrEpisodeFile,
  SonarrSeries,
  SonarrTag,
} from './sonarr.types.js';

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

  async fetchSeriesById(seriesId: number): Promise<SonarrSeries> {
    this.logger.debug(`Fetching series ${seriesId} from Sonarr`);
    const { data } = await firstValueFrom(
      this.http.get<SonarrSeries>(`/api/v3/series/${seriesId}`),
    );
    return data;
  }

  async updateSeries(seriesId: number, body: SonarrSeries): Promise<void> {
    this.logger.debug(`Updating series ${seriesId}`);
    await firstValueFrom(this.http.put(`/api/v3/series/${seriesId}`, body));
  }

  async fetchEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
    this.logger.debug(`Fetching episode files for series ${seriesId}`);
    const { data } = await firstValueFrom(
      this.http.get<SonarrEpisodeFile[]>('/api/v3/episodefile', {
        params: { seriesId },
      }),
    );
    return data;
  }

  async deleteEpisodeFile(episodeFileId: number): Promise<void> {
    this.logger.debug(`Deleting episode file ${episodeFileId}`);
    await firstValueFrom(
      this.http.delete(`/api/v3/episodefile/${episodeFileId}`),
    );
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
