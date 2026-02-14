import { describe, expect, test } from 'bun:test';
import {
  aggregateMovieWatchData,
  aggregateSeasonWatchData,
  type UserSeasonEpisodeData,
  type UserWatchRecord,
} from './jellyfin.aggregator.js';

describe('aggregateMovieWatchData', () => {
  test('aggregates watch data from multiple users', () => {
    const records: UserWatchRecord[] = [
      {
        username: 'Jackson',
        playCount: 2,
        lastPlayedDate: '2026-01-15T20:00:00Z',
      },
      {
        username: 'Partner',
        playCount: 1,
        lastPlayedDate: '2026-01-20T20:00:00Z',
      },
    ];

    const result = aggregateMovieWatchData(records, 2);

    expect(result.watched_by).toEqual(['Jackson', 'Partner']);
    expect(result.watched_by_all).toBe(true);
    expect(result.play_count).toBe(3);
    expect(result.last_played).toBe('2026-01-20T20:00:00Z');
  });

  test('watched_by_all is false when not all users watched', () => {
    const records: UserWatchRecord[] = [
      {
        username: 'Jackson',
        playCount: 1,
        lastPlayedDate: '2026-01-15T20:00:00Z',
      },
    ];

    const result = aggregateMovieWatchData(records, 3);

    expect(result.watched_by).toEqual(['Jackson']);
    expect(result.watched_by_all).toBe(false);
    expect(result.play_count).toBe(1);
  });

  test('returns empty data when no one has watched', () => {
    const result = aggregateMovieWatchData([], 2);

    expect(result.watched_by).toEqual([]);
    expect(result.watched_by_all).toBe(false);
    expect(result.play_count).toBe(0);
    expect(result.last_played).toBeNull();
  });

  test('handles null LastPlayedDate (marked as watched via API)', () => {
    const records: UserWatchRecord[] = [
      { username: 'Jackson', playCount: 1, lastPlayedDate: null },
      {
        username: 'Partner',
        playCount: 1,
        lastPlayedDate: '2026-01-10T20:00:00Z',
      },
    ];

    const result = aggregateMovieWatchData(records, 2);

    expect(result.watched_by).toEqual(['Jackson', 'Partner']);
    expect(result.watched_by_all).toBe(true);
    expect(result.last_played).toBe('2026-01-10T20:00:00Z');
  });

  test('watched_by_all is false when totalActiveUsers is 0', () => {
    const records: UserWatchRecord[] = [
      { username: 'Ghost', playCount: 1, lastPlayedDate: null },
    ];

    const result = aggregateMovieWatchData(records, 0);
    expect(result.watched_by_all).toBe(false);
  });

  test('all null dates result in null last_played', () => {
    const records: UserWatchRecord[] = [
      { username: 'Jackson', playCount: 1, lastPlayedDate: null },
      { username: 'Partner', playCount: 1, lastPlayedDate: null },
    ];

    const result = aggregateMovieWatchData(records, 2);
    expect(result.last_played).toBeNull();
  });
});

describe('aggregateSeasonWatchData', () => {
  test('user who watched all episodes counts as having watched the season', () => {
    const data: UserSeasonEpisodeData[] = [
      {
        username: 'Jackson',
        episodes: [
          {
            played: true,
            playCount: 2,
            lastPlayedDate: '2026-01-10T20:00:00Z',
          },
          {
            played: true,
            playCount: 1,
            lastPlayedDate: '2026-01-11T20:00:00Z',
          },
        ],
      },
    ];

    const result = aggregateSeasonWatchData(data, 1);

    expect(result.watched_by).toEqual(['Jackson']);
    expect(result.watched_by_all).toBe(true);
    // Min play count across episodes for Jackson: min(2, 1) = 1
    expect(result.play_count).toBe(1);
    expect(result.last_played).toBe('2026-01-11T20:00:00Z');
  });

  test('user who partially watched does not count', () => {
    const data: UserSeasonEpisodeData[] = [
      {
        username: 'Jackson',
        episodes: [
          {
            played: true,
            playCount: 1,
            lastPlayedDate: '2026-01-10T20:00:00Z',
          },
          { played: false, playCount: 0, lastPlayedDate: null },
          { played: false, playCount: 0, lastPlayedDate: null },
        ],
      },
    ];

    const result = aggregateSeasonWatchData(data, 1);

    expect(result.watched_by).toEqual([]);
    expect(result.watched_by_all).toBe(false);
    // Min play count across episodes: min(1, 0, 0) = 0
    expect(result.play_count).toBe(0);
    expect(result.last_played).toBe('2026-01-10T20:00:00Z');
  });

  test('aggregates across multiple users', () => {
    const data: UserSeasonEpisodeData[] = [
      {
        username: 'Jackson',
        episodes: [
          {
            played: true,
            playCount: 3,
            lastPlayedDate: '2026-01-10T20:00:00Z',
          },
          {
            played: true,
            playCount: 2,
            lastPlayedDate: '2026-01-11T20:00:00Z',
          },
        ],
      },
      {
        username: 'Partner',
        episodes: [
          {
            played: true,
            playCount: 1,
            lastPlayedDate: '2026-01-15T20:00:00Z',
          },
          {
            played: true,
            playCount: 1,
            lastPlayedDate: '2026-01-16T20:00:00Z',
          },
        ],
      },
    ];

    const result = aggregateSeasonWatchData(data, 2);

    expect(result.watched_by).toEqual(['Jackson', 'Partner']);
    expect(result.watched_by_all).toBe(true);
    // Jackson: min(3,2) = 2, Partner: min(1,1) = 1, total = 3
    expect(result.play_count).toBe(3);
    expect(result.last_played).toBe('2026-01-16T20:00:00Z');
  });

  test('returns empty data for no user data', () => {
    const result = aggregateSeasonWatchData([], 2);

    expect(result.watched_by).toEqual([]);
    expect(result.watched_by_all).toBe(false);
    expect(result.play_count).toBe(0);
    expect(result.last_played).toBeNull();
  });

  test('handles user with no episodes (empty season)', () => {
    const data: UserSeasonEpisodeData[] = [
      { username: 'Jackson', episodes: [] },
    ];

    const result = aggregateSeasonWatchData(data, 1);

    expect(result.watched_by).toEqual([]);
    expect(result.play_count).toBe(0);
  });

  test('watched_by_all requires all active users', () => {
    const data: UserSeasonEpisodeData[] = [
      {
        username: 'Jackson',
        episodes: [
          {
            played: true,
            playCount: 1,
            lastPlayedDate: '2026-01-10T20:00:00Z',
          },
        ],
      },
    ];

    // 3 total users but only Jackson watched
    const result = aggregateSeasonWatchData(data, 3);

    expect(result.watched_by).toEqual(['Jackson']);
    expect(result.watched_by_all).toBe(false);
  });

  test('handles null LastPlayedDate on episodes', () => {
    const data: UserSeasonEpisodeData[] = [
      {
        username: 'Jackson',
        episodes: [
          { played: true, playCount: 1, lastPlayedDate: null },
          { played: true, playCount: 1, lastPlayedDate: null },
        ],
      },
    ];

    const result = aggregateSeasonWatchData(data, 1);

    expect(result.watched_by).toEqual(['Jackson']);
    expect(result.last_played).toBeNull();
  });
});
