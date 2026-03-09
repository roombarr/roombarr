import { describe, expect, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import {
  axiosResponse,
  makeRadarrImportListMovie,
  makeRadarrMovie,
  makeRadarrTag,
} from '../test/index.js';
import { RadarrClient } from './radarr.client.js';

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
      const fixture = [makeRadarrMovie()];

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
      const fixture = [
        makeRadarrTag({ id: 1, label: 'keep-forever' }),
        makeRadarrTag({ id: 2, label: 'classics' }),
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchTags();
      expect(result).toEqual(fixture);
    });
  });

  describe('fetchMovie', () => {
    test('returns a single movie from Radarr API', async () => {
      const { client, http } = await setup();
      const fixture = makeRadarrMovie({ id: 42 });

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchMovie(42);
      expect(result).toEqual(fixture);
    });
  });

  describe('deleteMovie', () => {
    test('deletes a movie without error', async () => {
      const { client, http } = await setup();
      http.delete = () => of(axiosResponse(undefined)) as any;
      await expect(client.deleteMovie(1)).resolves.toBeUndefined();
    });

    test('passes deleteFiles parameter', async () => {
      const { client, http } = await setup();
      http.delete = () => of(axiosResponse(undefined)) as any;
      await expect(client.deleteMovie(1, false)).resolves.toBeUndefined();
    });
  });

  describe('updateMovie', () => {
    test('updates a movie without error', async () => {
      const { client, http } = await setup();
      const movie = makeRadarrMovie({ id: 1 });

      http.put = () => of(axiosResponse(undefined)) as any;
      await expect(client.updateMovie(1, movie)).resolves.toBeUndefined();
    });
  });

  describe('fetchImportListMovies', () => {
    test('returns import list movies from Radarr API', async () => {
      const { client, http } = await setup();
      const fixture = [
        makeRadarrImportListMovie({ tmdbId: 603, isExisting: true }),
        makeRadarrImportListMovie({ tmdbId: 999, isExisting: false }),
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchImportListMovies();
      expect(result).toEqual(fixture);
    });

    test('returns empty array when no import list movies exist', async () => {
      const { client, http } = await setup();
      http.get = () => of(axiosResponse([])) as any;
      const result = await client.fetchImportListMovies();
      expect(result).toEqual([]);
    });
  });
});
