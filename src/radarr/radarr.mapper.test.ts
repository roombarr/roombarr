import { describe, expect, test } from 'bun:test';
import { buildTagMap, mapMovie, resolveTagNames } from './radarr.mapper.js';
import type { RadarrMovie, RadarrTag } from './radarr.types.js';

const TAGS: RadarrTag[] = [
  { id: 1, label: 'keep-forever' },
  { id: 2, label: 'classics' },
  { id: 3, label: 'kids' },
];

function makeMovie(overrides: Partial<RadarrMovie> = {}): RadarrMovie {
  return {
    id: 1,
    title: 'The Matrix',
    tmdbId: 603,
    imdbId: 'tt0133093',
    year: 1999,
    path: '/movies/The Matrix (1999)',
    status: 'released',
    genres: ['action', 'sci-fi'],
    tags: [1, 2],
    monitored: true,
    hasFile: true,
    sizeOnDisk: 8_500_000_000,
    added: '2024-06-01T12:00:00Z',
    digitalRelease: '1999-09-21T00:00:00Z',
    physicalRelease: '1999-09-21T00:00:00Z',
    ...overrides,
  };
}

describe('buildTagMap', () => {
  test('builds id-to-lowercase-name map', () => {
    const map = buildTagMap(TAGS);
    expect(map.get(1)).toBe('keep-forever');
    expect(map.get(2)).toBe('classics');
    expect(map.get(3)).toBe('kids');
    expect(map.size).toBe(3);
  });

  test('lowercases tag labels', () => {
    const map = buildTagMap([{ id: 1, label: 'Keep-Forever' }]);
    expect(map.get(1)).toBe('keep-forever');
  });

  test('handles empty tag list', () => {
    const map = buildTagMap([]);
    expect(map.size).toBe(0);
  });
});

describe('resolveTagNames', () => {
  const tagMap = buildTagMap(TAGS);

  test('resolves known tag IDs to names', () => {
    expect(resolveTagNames([1, 3], tagMap)).toEqual(['keep-forever', 'kids']);
  });

  test('skips unknown tag IDs', () => {
    expect(resolveTagNames([1, 999], tagMap)).toEqual(['keep-forever']);
  });

  test('returns empty array for no tags', () => {
    expect(resolveTagNames([], tagMap)).toEqual([]);
  });
});

describe('mapMovie', () => {
  const tagMap = buildTagMap(TAGS);

  test('maps Radarr movie to RadarrData', () => {
    const movie = makeMovie();
    const result = mapMovie(movie, tagMap);

    expect(result).toEqual({
      added: '2024-06-01T12:00:00Z',
      size_on_disk: 8_500_000_000,
      monitored: true,
      tags: ['keep-forever', 'classics'],
      genres: ['action', 'sci-fi'],
      status: 'released',
      year: 1999,
      has_file: true,
      digital_release: '1999-09-21T00:00:00Z',
      physical_release: '1999-09-21T00:00:00Z',
      path: '/movies/The Matrix (1999)',
    });
  });

  test('handles null release dates', () => {
    const movie = makeMovie({
      digitalRelease: null,
      physicalRelease: null,
    });
    const result = mapMovie(movie, tagMap);

    expect(result.digital_release).toBeNull();
    expect(result.physical_release).toBeNull();
  });

  test('handles movie with no tags', () => {
    const movie = makeMovie({ tags: [] });
    const result = mapMovie(movie, tagMap);
    expect(result.tags).toEqual([]);
  });

  test('handles movie with no file', () => {
    const movie = makeMovie({ hasFile: false, sizeOnDisk: 0 });
    const result = mapMovie(movie, tagMap);
    expect(result.has_file).toBe(false);
    expect(result.size_on_disk).toBe(0);
  });

  test('handles empty genres', () => {
    const movie = makeMovie({ genres: [] });
    const result = mapMovie(movie, tagMap);
    expect(result.genres).toEqual([]);
  });

  test('handles null imdbId in source (not mapped to RadarrData)', () => {
    const movie = makeMovie({ imdbId: null });
    const result = mapMovie(movie, tagMap);
    // imdbId is on UnifiedMovie, not RadarrData — mapMovie still works
    expect(result.status).toBe('released');
  });
});
