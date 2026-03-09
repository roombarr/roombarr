import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { makeJellyfinItem, makeJellyfinUser } from '../test/index.js';
import { JellyfinService, seasonKey } from './jellyfin.service.js';

describe('JellyfinService', () => {
  let client: {
    fetchUsers: ReturnType<typeof mock>;
    fetchPlayedMovies: ReturnType<typeof mock>;
    fetchSeriesItems: ReturnType<typeof mock>;
    fetchSeriesSeasons: ReturnType<typeof mock>;
    fetchSeasonEpisodes: ReturnType<typeof mock>;
  };
  let service: JellyfinService;

  beforeEach(() => {
    client = {
      fetchUsers: mock(() => Promise.resolve([])),
      fetchPlayedMovies: mock(() => Promise.resolve([])),
      fetchSeriesItems: mock(() => Promise.resolve([])),
      fetchSeriesSeasons: mock(() => Promise.resolve([])),
      fetchSeasonEpisodes: mock(() => Promise.resolve([])),
    };
    service = new JellyfinService(client as any, 5);
  });

  describe('fetchMovieWatchData', () => {
    test('aggregates watch data by TMDB ID across multiple users', async () => {
      const users = [
        makeJellyfinUser({ Id: 'alice', Name: 'Alice' }),
        makeJellyfinUser({ Id: 'bob', Name: 'Bob' }),
      ];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchPlayedMovies = mock((userId: string) => {
        if (userId === 'alice') {
          return Promise.resolve([
            makeJellyfinItem({
              Id: 'movie-100',
              Name: 'Movie 100',
              ProviderIds: { Tmdb: '100' },
              UserData: {
                PlayCount: 2,
                Played: true,
                LastPlayedDate: '2024-12-01T20:00:00Z',
                IsFavorite: false,
              },
            }),
          ]);
        }
        return Promise.resolve([
          makeJellyfinItem({
            Id: 'movie-100',
            Name: 'Movie 100',
            ProviderIds: { Tmdb: '100' },
            UserData: {
              PlayCount: 1,
              Played: true,
              LastPlayedDate: '2024-11-15T10:00:00Z',
              IsFavorite: false,
            },
          }),
        ]);
      });

      const result = await service.fetchMovieWatchData();

      const data = result.get(100);
      expect(data).toBeDefined();
      expect(data!.watched_by).toEqual(['Alice', 'Bob']);
      expect(data!.watched_by_all).toBe(true);
      expect(data!.play_count).toBe(3);
      expect(data!.last_played).toBe('2024-12-01T20:00:00Z');
    });

    test('skips movies with missing TMDB provider ID', async () => {
      client.fetchUsers = mock(() =>
        Promise.resolve([makeJellyfinUser({ Id: 'alice', Name: 'Alice' })]),
      );
      client.fetchPlayedMovies = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'movie-unknown',
            Name: 'Movie unknown',
            ProviderIds: {},
            UserData: {
              PlayCount: 1,
              Played: true,
              IsFavorite: false,
            },
          }),
        ]),
      );

      const result = await service.fetchMovieWatchData();

      expect(result.size).toBe(0);
    });

    test('skips movies with non-numeric TMDB ID', async () => {
      client.fetchUsers = mock(() =>
        Promise.resolve([makeJellyfinUser({ Id: 'alice', Name: 'Alice' })]),
      );
      client.fetchPlayedMovies = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'movie-not-a-number',
            Name: 'Movie not-a-number',
            ProviderIds: { Tmdb: 'not-a-number' },
            UserData: {
              PlayCount: 1,
              Played: true,
              IsFavorite: false,
            },
          }),
        ]),
      );

      const result = await service.fetchMovieWatchData();

      expect(result.size).toBe(0);
    });

    test('returns empty map when no users exist', async () => {
      const result = await service.fetchMovieWatchData();

      expect(result.size).toBe(0);
      expect(client.fetchPlayedMovies).not.toHaveBeenCalled();
    });

    test('handles multiple movies across multiple users', async () => {
      const users = [
        makeJellyfinUser({ Id: 'alice', Name: 'Alice' }),
        makeJellyfinUser({ Id: 'bob', Name: 'Bob' }),
      ];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchPlayedMovies = mock((userId: string) => {
        if (userId === 'alice') {
          return Promise.resolve([
            makeJellyfinItem({
              Id: 'movie-100',
              Name: 'Movie 100',
              ProviderIds: { Tmdb: '100' },
              UserData: { PlayCount: 1, Played: true, IsFavorite: false },
            }),
            makeJellyfinItem({
              Id: 'movie-200',
              Name: 'Movie 200',
              ProviderIds: { Tmdb: '200' },
              UserData: { PlayCount: 1, Played: true, IsFavorite: false },
            }),
          ]);
        }
        return Promise.resolve([
          makeJellyfinItem({
            Id: 'movie-200',
            Name: 'Movie 200',
            ProviderIds: { Tmdb: '200' },
            UserData: { PlayCount: 2, Played: true, IsFavorite: false },
          }),
        ]);
      });

      const result = await service.fetchMovieWatchData();

      expect(result.size).toBe(2);
      expect(result.get(100)!.watched_by).toEqual(['Alice']);
      expect(result.get(200)!.watched_by).toEqual(['Alice', 'Bob']);
      expect(result.get(200)!.play_count).toBe(3);
    });
  });

  describe('fetchSeasonWatchData', () => {
    test('returns empty map when no users found', async () => {
      const result = await service.fetchSeasonWatchData([
        { tvdbId: 500, seasonNumber: 1 },
      ]);

      expect(result.size).toBe(0);
      expect(client.fetchSeriesItems).not.toHaveBeenCalled();
    });

    test('resolves TVDB to Jellyfin series and returns aggregated data', async () => {
      const users = [makeJellyfinUser({ Id: 'alice', Name: 'Alice' })];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'jf-series-1',
            Name: 'Series 500',
            Type: 'Series',
            ProviderIds: { Tvdb: '500' },
          }),
        ]),
      );
      client.fetchSeriesSeasons = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'jf-season-1',
            Name: 'Season 1',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 1,
          }),
        ]),
      );
      client.fetchSeasonEpisodes = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'ep-0',
            Name: 'Episode',
            Type: 'Episode',
            ProviderIds: {},
            UserData: {
              PlayCount: 1,
              Played: true,
              LastPlayedDate: '2024-12-01T20:00:00Z',
              IsFavorite: false,
            },
          }),
          makeJellyfinItem({
            Id: 'ep-1',
            Name: 'Episode',
            Type: 'Episode',
            ProviderIds: {},
            UserData: {
              PlayCount: 1,
              Played: true,
              LastPlayedDate: '2024-12-02T20:00:00Z',
              IsFavorite: false,
            },
          }),
        ]),
      );

      const result = await service.fetchSeasonWatchData([
        { tvdbId: 500, seasonNumber: 1 },
      ]);

      const key = seasonKey(500, 1);
      expect(result.has(key)).toBe(true);
      const data = result.get(key)!;
      expect(data.watched_by).toEqual(['Alice']);
      expect(data.play_count).toBe(1);
      expect(data.last_played).toBe('2024-12-02T20:00:00Z');
    });

    test('skips seasons with no Jellyfin series match', async () => {
      const users = [makeJellyfinUser({ Id: 'alice', Name: 'Alice' })];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() => Promise.resolve([]));

      const result = await service.fetchSeasonWatchData([
        { tvdbId: 999, seasonNumber: 1 },
      ]);

      expect(result.size).toBe(0);
    });

    test('skips seasons with no matching Jellyfin season number', async () => {
      const users = [makeJellyfinUser({ Id: 'alice', Name: 'Alice' })];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'jf-series-1',
            Name: 'Series 500',
            Type: 'Series',
            ProviderIds: { Tvdb: '500' },
          }),
        ]),
      );
      client.fetchSeriesSeasons = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'jf-season-1',
            Name: 'Season 2',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 2,
          }),
        ]),
      );

      const result = await service.fetchSeasonWatchData([
        { tvdbId: 500, seasonNumber: 1 },
      ]);

      expect(result.size).toBe(0);
    });

    test('handles multiple seasons from different series', async () => {
      const users = [makeJellyfinUser({ Id: 'alice', Name: 'Alice' })];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'jf-series-1',
            Name: 'Series 500',
            Type: 'Series',
            ProviderIds: { Tvdb: '500' },
          }),
          makeJellyfinItem({
            Id: 'jf-series-2',
            Name: 'Series 600',
            Type: 'Series',
            ProviderIds: { Tvdb: '600' },
          }),
        ]),
      );
      client.fetchSeriesSeasons = mock((_userId: string, seriesId: string) => {
        if (seriesId === 'jf-series-1') {
          return Promise.resolve([
            makeJellyfinItem({
              Id: 'jf-s1-s1',
              Name: 'Season 1',
              Type: 'Season',
              ProviderIds: {},
              IndexNumber: 1,
            }),
          ]);
        }
        return Promise.resolve([
          makeJellyfinItem({
            Id: 'jf-s2-s3',
            Name: 'Season 3',
            Type: 'Season',
            ProviderIds: {},
            IndexNumber: 3,
          }),
        ]);
      });
      client.fetchSeasonEpisodes = mock(() =>
        Promise.resolve([
          makeJellyfinItem({
            Id: 'ep-0',
            Name: 'Episode',
            Type: 'Episode',
            ProviderIds: {},
            UserData: {
              PlayCount: 1,
              Played: true,
              LastPlayedDate: '2024-12-01T20:00:00Z',
              IsFavorite: false,
            },
          }),
        ]),
      );

      const result = await service.fetchSeasonWatchData([
        { tvdbId: 500, seasonNumber: 1 },
        { tvdbId: 600, seasonNumber: 3 },
      ]);

      expect(result.size).toBe(2);
      expect(result.has(seasonKey(500, 1))).toBe(true);
      expect(result.has(seasonKey(600, 3))).toBe(true);
    });
  });

  describe('seasonKey', () => {
    test('produces correct composite key', () => {
      expect(seasonKey(500, 3)).toBe('500:3');
    });
  });
});
