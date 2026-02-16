import { describe, expect, test } from 'bun:test';
import type { UnifiedMedia } from '../shared/types.js';
import { resolveField } from './field-resolver.js';

function makeMovie(overrides: Record<string, any> = {}): UnifiedMedia {
  return {
    type: 'movie',
    tmdb_id: 12345,
    imdb_id: 'tt1234567',
    title: 'Test Movie',
    year: 2024,
    radarr: {
      added: '2024-01-01T00:00:00Z',
      size_on_disk: 5_000_000_000,
      monitored: true,
      tags: ['permanent', 'favorite'],
      genres: ['Action', 'Drama'],
      status: 'released',
      year: 2024,
      has_file: true,
      digital_release: '2024-03-01T00:00:00Z',
      physical_release: '2024-04-01T00:00:00Z',
      path: '/movies/test',
      on_import_list: false,
      import_list_ids: [],
    },
    state: null,
    jellyfin: {
      watched_by: ['Alice', 'Bob'],
      watched_by_all: true,
      last_played: '2024-06-01T00:00:00Z',
      play_count: 3,
    },
    jellyseerr: {
      requested_by: 'Alice',
      requested_at: '2024-01-15T00:00:00Z',
      request_status: 'available',
    },
    ...overrides,
  };
}

function makeSeason(overrides: Record<string, any> = {}): UnifiedMedia {
  return {
    type: 'season',
    tvdb_id: 54321,
    title: 'Test Show',
    year: 2023,
    sonarr: {
      tags: ['favorite'],
      genres: ['Sci-Fi'],
      status: 'ended',
      year: 2023,
      path: '/tv/test',
      season: {
        season_number: 1,
        monitored: true,
        episode_count: 10,
        episode_file_count: 10,
        size_on_disk: 15_000_000_000,
      },
    },
    jellyfin: {
      watched_by: ['Alice'],
      watched_by_all: false,
      last_played: '2024-05-01T00:00:00Z',
      play_count: 1,
    },
    jellyseerr: null,
    state: null,
    ...overrides,
  };
}

describe('resolveField', () => {
  test('resolves top-level radarr field', () => {
    const result = resolveField(makeMovie(), 'radarr.added');
    expect(result).toEqual({
      value: '2024-01-01T00:00:00Z',
      resolved: true,
    });
  });

  test('resolves radarr array field', () => {
    const result = resolveField(makeMovie(), 'radarr.tags');
    expect(result).toEqual({
      value: ['permanent', 'favorite'],
      resolved: true,
    });
  });

  test('resolves radarr boolean field', () => {
    const result = resolveField(makeMovie(), 'radarr.monitored');
    expect(result).toEqual({ value: true, resolved: true });
  });

  test('resolves jellyfin field on movie', () => {
    const result = resolveField(makeMovie(), 'jellyfin.watched_by_all');
    expect(result).toEqual({ value: true, resolved: true });
  });

  test('resolves jellyseerr field', () => {
    const result = resolveField(makeMovie(), 'jellyseerr.requested_by');
    expect(result).toEqual({ value: 'Alice', resolved: true });
  });

  test('returns unresolved for null service data', () => {
    const movie = makeMovie({ jellyfin: null });
    const result = resolveField(movie, 'jellyfin.watched_by');
    expect(result).toEqual({ value: undefined, resolved: false });
  });

  test('resolves sonarr season nested field', () => {
    const result = resolveField(
      makeSeason(),
      'sonarr.season.episode_file_count',
    );
    expect(result).toEqual({ value: 10, resolved: true });
  });

  test('resolves sonarr series-level field', () => {
    const result = resolveField(makeSeason(), 'sonarr.tags');
    expect(result).toEqual({ value: ['favorite'], resolved: true });
  });

  test('returns unresolved for null jellyseerr on season', () => {
    const season = makeSeason({ jellyseerr: null });
    const result = resolveField(season, 'jellyseerr.requested_by');
    expect(result).toEqual({ value: undefined, resolved: false });
  });

  test('resolves deeply nested path', () => {
    const result = resolveField(makeSeason(), 'sonarr.season.size_on_disk');
    expect(result).toEqual({ value: 15_000_000_000, resolved: true });
  });
});
