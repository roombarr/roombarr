import { describe, expect, test } from 'bun:test';
import { makeMovie, makeSeason } from '../test/index.js';
import { resolveField } from './field-resolver.js';

const jellyfinData = {
  watched_by: ['Alice', 'Bob'],
  watched_by_all: true,
  last_played: '2024-06-01T00:00:00Z',
  play_count: 3,
};

const jellyseerrData = {
  requested_by: 'Alice',
  requested_at: '2024-01-15T00:00:00Z',
  request_status: 'available',
};

describe('resolveField', () => {
  test('resolves top-level radarr field', () => {
    const result = resolveField(makeMovie(), 'radarr.added');
    expect(result).toEqual({
      value: '2024-01-01T00:00:00Z',
      resolved: true,
    });
  });

  test('resolves radarr array field', () => {
    const movie = makeMovie({ radarr: { tags: ['permanent', 'favorite'] } });
    const result = resolveField(movie, 'radarr.tags');
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
    const movie = makeMovie({ jellyfin: jellyfinData });
    const result = resolveField(movie, 'jellyfin.watched_by_all');
    expect(result).toEqual({ value: true, resolved: true });
  });

  test('resolves jellyseerr field', () => {
    const movie = makeMovie({ jellyseerr: jellyseerrData });
    const result = resolveField(movie, 'jellyseerr.requested_by');
    expect(result).toEqual({ value: 'Alice', resolved: true });
  });

  test('returns unresolved for null service data', () => {
    const result = resolveField(makeMovie(), 'jellyfin.watched_by');
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
    const season = makeSeason({ sonarr: { tags: ['favorite'] } });
    const result = resolveField(season, 'sonarr.tags');
    expect(result).toEqual({ value: ['favorite'], resolved: true });
  });

  test('returns unresolved for null jellyseerr on season', () => {
    const result = resolveField(makeSeason(), 'jellyseerr.requested_by');
    expect(result).toEqual({ value: undefined, resolved: false });
  });

  test('resolves radarr.has_file boolean field', () => {
    const result = resolveField(makeMovie(), 'radarr.has_file');
    expect(result).toEqual({ value: true, resolved: true });
  });

  test('resolves radarr.has_file as false without treating it as unresolved', () => {
    const movie = makeMovie({
      radarr: { has_file: false, size_on_disk: 0, tags: [], genres: [] },
    });
    const result = resolveField(movie, 'radarr.has_file');
    expect(result).toEqual({ value: false, resolved: true });
  });

  test('resolves deeply nested path', () => {
    const season = makeSeason({
      sonarr: { season: { size_on_disk: 15_000_000_000 } },
    });
    const result = resolveField(season, 'sonarr.season.size_on_disk');
    expect(result).toEqual({ value: 15_000_000_000, resolved: true });
  });
});
