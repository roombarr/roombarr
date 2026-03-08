import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { JellyfinService, seasonKey } from './jellyfin.service.js';
import type { JellyfinItem, JellyfinUser } from './jellyfin.types.js';

function makeUser(name: string, id = name.toLowerCase()): JellyfinUser {
  return { Id: id, Name: name, Policy: { IsDisabled: false } };
}

function makeMovieItem(
  tmdbId: string | undefined,
  playCount: number,
  lastPlayedDate: string | null = null,
): JellyfinItem {
  return {
    Id: `movie-${tmdbId}`,
    Name: `Movie ${tmdbId}`,
    Type: 'Movie',
    ProviderIds: tmdbId ? { Tmdb: tmdbId } : {},
    UserData: {
      PlayCount: playCount,
      Played: playCount > 0,
      LastPlayedDate: lastPlayedDate ?? undefined,
      IsFavorite: false,
    },
  };
}

function makeSeriesItem(tvdbId: string, jellyfinId: string): JellyfinItem {
  return {
    Id: jellyfinId,
    Name: `Series ${tvdbId}`,
    Type: 'Series',
    ProviderIds: { Tvdb: tvdbId },
  };
}

function makeSeasonItem(
  jellyfinId: string,
  seasonNumber: number,
): JellyfinItem {
  return {
    Id: jellyfinId,
    Name: `Season ${seasonNumber}`,
    Type: 'Season',
    ProviderIds: {},
    IndexNumber: seasonNumber,
  };
}

function makeEpisodeItem(
  played: boolean,
  playCount: number,
  lastPlayedDate: string | null = null,
): JellyfinItem {
  return {
    Id: `ep-${Math.random().toString(36).slice(2)}`,
    Name: 'Episode',
    Type: 'Episode',
    ProviderIds: {},
    UserData: {
      PlayCount: playCount,
      Played: played,
      LastPlayedDate: lastPlayedDate ?? undefined,
      IsFavorite: false,
    },
  };
}

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
      const users = [makeUser('Alice'), makeUser('Bob')];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchPlayedMovies = mock((userId: string) => {
        if (userId === 'alice') {
          return Promise.resolve([
            makeMovieItem('100', 2, '2024-12-01T20:00:00Z'),
          ]);
        }
        return Promise.resolve([
          makeMovieItem('100', 1, '2024-11-15T10:00:00Z'),
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
      client.fetchUsers = mock(() => Promise.resolve([makeUser('Alice')]));
      client.fetchPlayedMovies = mock(() =>
        Promise.resolve([makeMovieItem(undefined, 1)]),
      );

      const result = await service.fetchMovieWatchData();

      expect(result.size).toBe(0);
    });

    test('skips movies with non-numeric TMDB ID', async () => {
      client.fetchUsers = mock(() => Promise.resolve([makeUser('Alice')]));
      client.fetchPlayedMovies = mock(() =>
        Promise.resolve([makeMovieItem('not-a-number', 1)]),
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
      const users = [makeUser('Alice'), makeUser('Bob')];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchPlayedMovies = mock((userId: string) => {
        if (userId === 'alice') {
          return Promise.resolve([
            makeMovieItem('100', 1),
            makeMovieItem('200', 1),
          ]);
        }
        return Promise.resolve([makeMovieItem('200', 2)]);
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
      const users = [makeUser('Alice')];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() =>
        Promise.resolve([makeSeriesItem('500', 'jf-series-1')]),
      );
      client.fetchSeriesSeasons = mock(() =>
        Promise.resolve([makeSeasonItem('jf-season-1', 1)]),
      );
      client.fetchSeasonEpisodes = mock(() =>
        Promise.resolve([
          makeEpisodeItem(true, 1, '2024-12-01T20:00:00Z'),
          makeEpisodeItem(true, 1, '2024-12-02T20:00:00Z'),
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
      const users = [makeUser('Alice')];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() => Promise.resolve([]));

      const result = await service.fetchSeasonWatchData([
        { tvdbId: 999, seasonNumber: 1 },
      ]);

      expect(result.size).toBe(0);
    });

    test('skips seasons with no matching Jellyfin season number', async () => {
      const users = [makeUser('Alice')];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() =>
        Promise.resolve([makeSeriesItem('500', 'jf-series-1')]),
      );
      client.fetchSeriesSeasons = mock(() =>
        Promise.resolve([makeSeasonItem('jf-season-1', 2)]),
      );

      const result = await service.fetchSeasonWatchData([
        { tvdbId: 500, seasonNumber: 1 },
      ]);

      expect(result.size).toBe(0);
    });

    test('handles multiple seasons from different series', async () => {
      const users = [makeUser('Alice')];
      client.fetchUsers = mock(() => Promise.resolve(users));
      client.fetchSeriesItems = mock(() =>
        Promise.resolve([
          makeSeriesItem('500', 'jf-series-1'),
          makeSeriesItem('600', 'jf-series-2'),
        ]),
      );
      client.fetchSeriesSeasons = mock((_userId: string, seriesId: string) => {
        if (seriesId === 'jf-series-1') {
          return Promise.resolve([makeSeasonItem('jf-s1-s1', 1)]);
        }
        return Promise.resolve([makeSeasonItem('jf-s2-s3', 3)]);
      });
      client.fetchSeasonEpisodes = mock(() =>
        Promise.resolve([makeEpisodeItem(true, 1, '2024-12-01T20:00:00Z')]),
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
