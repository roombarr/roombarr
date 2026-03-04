import { describe, expect, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import type { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { RadarrClient } from './radarr.client.js';
import type { RadarrMovie, RadarrTag } from './radarr.types.js';

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };
}

describe('RadarrClient', () => {
  async function setup() {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [RadarrClient],
    }).compile();

    const client = module.get(RadarrClient);
    const http = module.get(HttpService);
    return { client, http };
  }

  describe('fetchMovies', () => {
    test('returns movies from Radarr API', async () => {
      const { client, http } = await setup();
      const fixture: RadarrMovie[] = [
        {
          id: 1,
          title: 'The Matrix',
          tmdbId: 603,
          imdbId: 'tt0133093',
          year: 1999,
          path: '/movies/The Matrix (1999)',
          status: 'released',
          genres: ['action'],
          tags: [1],
          monitored: true,
          sizeOnDisk: 8_500_000_000,
          hasFile: true,
          added: '2024-06-01T12:00:00Z',
          digitalRelease: null,
          physicalRelease: null,
        },
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchMovies();
      expect(result).toEqual(fixture);
    });

    test('returns empty array for empty library', async () => {
      const { client, http } = await setup();
      http.get = () => of(axiosResponse([])) as any;
      const result = await client.fetchMovies();
      expect(result).toEqual([]);
    });
  });

  describe('fetchTags', () => {
    test('returns tags from Radarr API', async () => {
      const { client, http } = await setup();
      const fixture: RadarrTag[] = [
        { id: 1, label: 'keep-forever' },
        { id: 2, label: 'classics' },
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchTags();
      expect(result).toEqual(fixture);
    });
  });
});
