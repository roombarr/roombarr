import { describe, expect, test } from 'bun:test';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { axiosResponse } from '../test/index.js';
import { JellyfinClient } from './jellyfin.client.js';
import type { JellyfinItemsResponse, JellyfinUser } from './jellyfin.types.js';

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
      const fixture: JellyfinUser[] = [
        {
          Id: 'user-1',
          Name: 'Jackson',
          Policy: { IsDisabled: false },
        },
        {
          Id: 'user-2',
          Name: 'Partner',
          Policy: { IsDisabled: false },
        },
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
          {
            Id: 'item-1',
            Name: 'Inception',
            Type: 'Movie',
            ProviderIds: { Tmdb: '27205' },
            UserData: {
              PlayCount: 2,
              Played: true,
              LastPlayedDate: '2026-01-15T20:00:00Z',
              IsFavorite: false,
            },
          },
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

      // Create 150 items to require 2 pages (page size is 100)
      const page1Items = Array.from({ length: 100 }, (_, i) => ({
        Id: `item-${i}`,
        Name: `Movie ${i}`,
        Type: 'Movie',
        ProviderIds: { Tmdb: `${i}` },
        UserData: {
          PlayCount: 1,
          Played: true,
          IsFavorite: false,
        },
      }));

      const page2Items = Array.from({ length: 50 }, (_, i) => ({
        Id: `item-${100 + i}`,
        Name: `Movie ${100 + i}`,
        Type: 'Movie',
        ProviderIds: { Tmdb: `${100 + i}` },
        UserData: {
          PlayCount: 1,
          Played: true,
          IsFavorite: false,
        },
      }));

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
          {
            Id: 'series-1',
            Name: 'Breaking Bad',
            Type: 'Series',
            ProviderIds: { Tvdb: '81189', Tmdb: '1396' },
          },
        ],
        TotalRecordCount: 1,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesItems('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].ProviderIds.Tvdb).toBe('81189');
    });
  });

  describe('fetchSeasonEpisodes', () => {
    test('returns episodes with per-user watch data', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [
          {
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
          },
          {
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
          },
        ],
        TotalRecordCount: 2,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeasonEpisodes('user-1', 'season-1');
      expect(result).toHaveLength(2);
      expect(result[0].UserData?.Played).toBe(true);
    });
  });

  describe('fetchSeriesSeasons', () => {
    test('returns seasons for a series', async () => {
      const { client, http } = await setup();
      const fixture: JellyfinItemsResponse = {
        Items: [
          {
            Id: 'season-1',
            Name: 'Season 1',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 1,
          },
          {
            Id: 'season-2',
            Name: 'Season 2',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 2,
          },
        ],
        TotalRecordCount: 2,
      };

      http.get = () => of(axiosResponse(fixture)) as any;
      const result = await client.fetchSeriesSeasons('user-1', 'series-1');
      expect(result).toHaveLength(2);
      expect(result[0].IndexNumber).toBe(1);
    });
  });
});
