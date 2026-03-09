import { describe, expect, mock, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import {
  axiosResponse,
  makeSonarrEpisodeFile,
  makeSonarrSeries,
  makeSonarrTag,
} from '../test/index.js';
import { SonarrClient } from './sonarr.client.js';

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
      const fixture = [makeSonarrSeries()];

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

  describe('fetchSeriesById', () => {
    test('returns a single series from Sonarr API', async () => {
      const { client, http } = await setup();
      const fixture = makeSonarrSeries({ id: 42 });

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesById(42);
      expect(result).toEqual(fixture);
    });
  });

  describe('updateSeries', () => {
    test('updates a series without error', async () => {
      const { client, http } = await setup();
      const series = makeSonarrSeries({ id: 1 });
      const putSpy = mock(() => of(axiosResponse(undefined)));
      http.put = putSpy as any;
      await client.updateSeries(1, series);
      expect(putSpy).toHaveBeenCalledWith('/api/v3/series/1', series);
    });
  });

  describe('fetchEpisodeFiles', () => {
    test('returns episode files from Sonarr API', async () => {
      const { client, http } = await setup();
      const fixture = [makeSonarrEpisodeFile()];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchEpisodeFiles(1);
      expect(result).toEqual(fixture);
    });
  });

  describe('deleteEpisodeFile', () => {
    test('deletes an episode file without error', async () => {
      const { client, http } = await setup();
      const deleteSpy = mock(() => of(axiosResponse(undefined)));
      http.delete = deleteSpy as any;
      await client.deleteEpisodeFile(1);
      expect(deleteSpy).toHaveBeenCalledWith('/api/v3/episodefile/1');
    });
  });

  describe('fetchTags', () => {
    test('returns tags from Sonarr API', async () => {
      const { client, http } = await setup();
      const fixture = [
        makeSonarrTag({ id: 1, label: 'keep-forever' }),
        makeSonarrTag({ id: 2, label: 'kids' }),
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchTags();
      expect(result).toEqual(fixture);
    });
  });
});
