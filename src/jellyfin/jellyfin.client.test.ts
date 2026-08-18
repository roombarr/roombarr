import { describe, expect, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import {
  axiosResponse,
  makeJellyfinItem,
  makeJellyfinUser,
} from '../test/index';
import { JellyfinClient } from './jellyfin.client';
import type { JellyfinItemsResponse } from './jellyfin.types';

describe('JellyfinClient', () => {
  async function setup() {
    const module = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [JellyfinClient],
    }).compile();

    const client = module.get(JellyfinClient);
    const http = module.get(HttpService);
    return { client, http };
  }

  describe('fetchUsers', () => {
    test('returns active users from Jellyfin', async () => {
      const { client, http } = await setup();
      const fixture = [
        makeJellyfinUser({ Id: 'user-1', Name: 'Jackson' }),
        makeJellyfinUser({ Id: 'user-2', Name: 'Partner' }),
      ];

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchUsers();
      expect(result).toEqual(fixture);
    });

    test('returns empty array when no users exist', async () => {
      const { client, http } = await setup();
      http.get = () => of(axiosResponse([])) as any;
      const result = await client.fetchUsers();
      expect(result).toEqual([]);
    });
  });

  describe('fetchPlayedMovies', () => {
    test('returns played movies for a user', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [
          makeJellyfinItem({
            Id: 'item-1',
            Name: 'Inception',
            ProviderIds: { Tmdb: '27205' },
            UserData: {
              PlayCount: 2,
              Played: true,
              LastPlayedDate: '2026-01-15T20:00:00Z',
              IsFavorite: false,
            },
          }),
        ],
        TotalRecordCount: 1,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchPlayedMovies('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].Name).toBe('Inception');
      expect(result[0].ProviderIds.Tmdb).toBe('27205');
    });

    test('returns empty array for user with no watched movies', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [],
        TotalRecordCount: 0,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchPlayedMovies('user-1');
      expect(result).toEqual([]);
    });

    test('paginates through large libraries', async () => {
      const { client, http } = await setup();

      const page1Items = Array.from({ length: 100 }, (_, i) =>
        makeJellyfinItem({
          Id: `item-${i}`,
          Name: `Movie ${i}`,
          ProviderIds: { Tmdb: `${i}` },
          UserData: {
            PlayCount: 1,
            Played: true,
            IsFavorite: false,
          },
        }),
      );

      const page2Items = Array.from({ length: 50 }, (_, i) =>
        makeJellyfinItem({
          Id: `item-${100 + i}`,
          Name: `Movie ${100 + i}`,
          ProviderIds: { Tmdb: `${100 + i}` },
          UserData: {
            PlayCount: 1,
            Played: true,
            IsFavorite: false,
          },
        }),
      );

      let callCount = 0;
      http.get = () => {
        callCount++;
        if (callCount === 1) {
          return of(
            axiosResponse({
              Items: page1Items,
              TotalRecordCount: 150,
            }),
          ) as any;
        }
        return of(
          axiosResponse({
            Items: page2Items,
            TotalRecordCount: 150,
          }),
        ) as any;
      };

      const result = await client.fetchPlayedMovies('user-1');
      expect(result).toHaveLength(150);
      expect(callCount).toBe(2);
    });
  });

  describe('fetchSeriesItems', () => {
    test('returns series with provider IDs', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [
          makeJellyfinItem({
            Id: 'series-1',
            Name: 'Breaking Bad',
            Type: 'Series',
            ProviderIds: { Tvdb: '81189', Tmdb: '1396' },
          }),
        ],
        TotalRecordCount: 1,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesItems('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].ProviderIds.Tvdb).toBe('81189');
    });

    test('returns empty array when user has no series', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [],
        TotalRecordCount: 0,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesItems('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('fetchSeasonEpisodes', () => {
    test('returns episodes with per-user watch data', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [
          makeJellyfinItem({
            Id: 'ep-1',
            Name: 'Pilot',
            Type: 'Episode',
            ProviderIds: {},
            ParentIndexNumber: 1,
            IndexNumber: 1,
            UserData: {
              PlayCount: 1,
              Played: true,
              LastPlayedDate: '2026-01-10T20:00:00Z',
              IsFavorite: false,
            },
          }),
          makeJellyfinItem({
            Id: 'ep-2',
            Name: "Cat's in the Bag...",
            Type: 'Episode',
            ProviderIds: {},
            ParentIndexNumber: 1,
            IndexNumber: 2,
            UserData: {
              PlayCount: 1,
              Played: true,
              LastPlayedDate: '2026-01-11T20:00:00Z',
              IsFavorite: false,
            },
          }),
        ],
        TotalRecordCount: 2,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeasonEpisodes('user-1', 'season-1');
      expect(result).toHaveLength(2);
      expect(result[0].UserData?.Played).toBe(true);
    });

    test('returns empty array when season has no episodes', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [],
        TotalRecordCount: 0,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeasonEpisodes('user-1', 'season-1');
      expect(result).toEqual([]);
    });
  });

  describe('fetchSeriesSeasons', () => {
    test('returns seasons for a series', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [
          makeJellyfinItem({
            Id: 'season-1',
            Name: 'Season 1',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 1,
          }),
          makeJellyfinItem({
            Id: 'season-2',
            Name: 'Season 2',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 2,
          }),
        ],
        TotalRecordCount: 2,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesSeasons('user-1', 'series-1');
      expect(result).toHaveLength(2);
      expect(result[0].IndexNumber).toBe(1);
    });

    test('returns empty array when series has no seasons', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [],
        TotalRecordCount: 0,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesSeasons('user-1', 'series-1');
      expect(result).toEqual([]);
    });
  });
  describe('pagination termination', () => {
    test('stops on an empty page even when TotalRecordCount is larger', async () => {
      const { client, http } = await setup();
      let calls = 0;

      // The shape that previously spun forever: a short first page, then empty
      // pages, with the server still claiming more records exist.
      http.get = () => {
        calls++;
        const Items =
          calls === 1
            ? Array.from({ length: 100 }, (_, i) =>
                makeJellyfinItem({ Id: `item-${i}` }),
              )
            : [];
        return of(axiosResponse({ Items, TotalRecordCount: 5000 })) as any;
      };

      const result = await client.fetchPlayedMovies('user-1');

      expect(result).toHaveLength(100);
      expect(calls).toBe(2);
    });

    test('stops on a short page even when TotalRecordCount is larger', async () => {
      const { client, http } = await setup();
      let calls = 0;

      // Fewer items than the page size means the result set is exhausted;
      // asking for the next page would only skip records.
      http.get = () => {
        calls++;
        return of(
          axiosResponse({
            Items: Array.from({ length: 40 }, (_, i) =>
              makeJellyfinItem({ Id: `item-${i}` }),
            ),
            TotalRecordCount: 5000,
          }),
        ) as any;
      };

      const result = await client.fetchPlayedMovies('user-1');

      expect(result).toHaveLength(40);
      expect(calls).toBe(1);
    });

    test('stops when TotalRecordCount is missing', async () => {
      const { client, http } = await setup();
      let calls = 0;

      // A full page, so termination can only come from the missing count.
      http.get = () => {
        calls++;
        return of(
          axiosResponse({
            Items: Array.from({ length: 100 }, (_, i) =>
              makeJellyfinItem({ Id: `item-${i}` }),
            ),
          }),
        ) as any;
      };

      const result = await client.fetchSeriesItems('user-1');

      expect(result).toHaveLength(100);
      expect(calls).toBe(1);
    });

    test('throws when a page is missing its Items array', async () => {
      const { client, http } = await setup();
      http.get = () => of(axiosResponse({ TotalRecordCount: 10 })) as any;

      await expect(client.fetchSeriesItems('user-1')).rejects.toThrow(
        /malformed page/,
      );
    });

    test('paginates until TotalRecordCount is reached', async () => {
      const { client, http } = await setup();
      let calls = 0;

      http.get = () => {
        calls++;
        return of(
          axiosResponse({
            Items: Array.from({ length: 100 }, (_, i) =>
              makeJellyfinItem({ Id: `page-${calls}-item-${i}` }),
            ),
            TotalRecordCount: 250,
          }),
        ) as any;
      };

      const result = await client.fetchSeriesItems('user-1');

      expect(result).toHaveLength(300);
      expect(calls).toBe(3);
    });
  });
});
