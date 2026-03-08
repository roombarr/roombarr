import { describe, expect, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { axiosResponse } from '../test/index.js';
import { SonarrClient } from './sonarr.client.js';
import type { SonarrSeries, SonarrTag } from './sonarr.types.js';

describe('SonarrClient', () => {
  async function setup() {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [SonarrClient],
    }).compile();

    const client = module.get(SonarrClient);
    const http = module.get(HttpService);
    return { client, http };
  }

  describe('fetchSeries', () => {
    test('returns series from Sonarr API', async () => {
      const { client, http } = await setup();
      const fixture: SonarrSeries[] = [
        {
          id: 1,
          title: 'Breaking Bad',
          tvdbId: 81189,
          imdbId: 'tt0903747',
          year: 2008,
          path: '/tv/Breaking Bad',
          status: 'ended',
          genres: ['drama'],
          tags: [1],
          monitored: true,
          seasons: [
            {
              seasonNumber: 1,
              monitored: true,
              statistics: {
                episodeCount: 7,
                episodeFileCount: 7,
                sizeOnDisk: 14_000_000_000,
                totalEpisodeCount: 7,
                percentOfEpisodes: 100,
              },
            },
          ],
        },
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeries();
      expect(result).toEqual(fixture);
    });

    test('returns empty array for empty library', async () => {
      const { client, http } = await setup();
      http.get = () => of(axiosResponse([])) as any;
      const result = await client.fetchSeries();
      expect(result).toEqual([]);
    });
  });

  describe('fetchTags', () => {
    test('returns tags from Sonarr API', async () => {
      const { client, http } = await setup();
      const fixture: SonarrTag[] = [
        { id: 1, label: 'keep-forever' },
        { id: 2, label: 'kids' },
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchTags();
      expect(result).toEqual(fixture);
    });
  });
});
