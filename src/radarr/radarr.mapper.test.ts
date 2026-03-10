import { describe, expect, test } from 'bun:test';
import {
  makeRadarrImportListMovie,
  makeRadarrMovie,
  makeRadarrTag,
} from '../test/index';
import {
  buildImportListIndex,
  buildTagMap,
  mapMovie,
  resolveTagNames,
} from './radarr.mapper';

const TAGS = [
  makeRadarrTag({ id: 1, label: 'keep-forever' }),
  makeRadarrTag({ id: 2, label: 'classics' }),
  makeRadarrTag({ id: 3, label: 'kids' }),
];

describe('buildTagMap', () => {
  test('builds id-to-lowercase-name map', () => {
    const map = buildTagMap(TAGS);
    expect(map.get(1)).toBe('keep-forever');
    expect(map.get(2)).toBe('classics');
    expect(map.get(3)).toBe('kids');
    expect(map.size).toBe(3);
  });

  test('lowercases tag labels', () => {
    const map = buildTagMap([makeRadarrTag({ id: 1, label: 'Keep-Forever' })]);
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

describe('buildImportListIndex', () => {
  test('indexes existing movies by tmdbId', () => {
    const movies = [
      makeRadarrImportListMovie({
        tmdbId: 603,
        lists: [1, 3],
        title: 'The Matrix',
        isExisting: true,
      }),
      makeRadarrImportListMovie({
        tmdbId: 999,
        lists: [2],
        title: 'New Movie',
        isExisting: false,
      }),
    ];
    const index = buildImportListIndex(movies);
    expect(index.get(603)).toEqual([1, 3]);
    expect(index.has(999)).toBe(false);
  });

  test('handles empty list', () => {
    const index = buildImportListIndex([]);
    expect(index.size).toBe(0);
  });
});

describe('mapMovie', () => {
  const tagMap = buildTagMap(TAGS);
  const emptyImportIndex = new Map<number, number[]>();

  test('maps Radarr movie to RadarrData', () => {
    const movie = makeRadarrMovie({
      year: 1999,
      path: '/movies/The Matrix (1999)',
      genres: ['action', 'sci-fi'],
      tags: [1, 2],
      sizeOnDisk: 8_500_000_000,
      digitalRelease: '1999-09-21T00:00:00Z',
      physicalRelease: '1999-09-21T00:00:00Z',
    });
    const result = mapMovie(movie, tagMap, emptyImportIndex);

    expect(result).toEqual({
      added: '2024-06-01T12:00:00Z',
      size_on_disk: 8_500_000_000,
      has_file: true,
      monitored: true,
      tags: ['keep-forever', 'classics'],
      genres: ['action', 'sci-fi'],
      status: 'released',
      year: 1999,
      digital_release: '1999-09-21T00:00:00Z',
      physical_release: '1999-09-21T00:00:00Z',
      path: '/movies/The Matrix (1999)',
      on_import_list: false,
      import_list_ids: [],
    });
  });

  test('includes import list data when movie is on an import list', () => {
    const movie = makeRadarrMovie({ tmdbId: 603 });
    const importIndex = new Map([[603, [1, 5]]]);
    const result = mapMovie(movie, tagMap, importIndex);

    expect(result.on_import_list).toBe(true);
    expect(result.import_list_ids).toEqual([1, 5]);
  });

  test('handles null release dates', () => {
    const movie = makeRadarrMovie({
      digitalRelease: null,
      physicalRelease: null,
    });
    const result = mapMovie(movie, tagMap, emptyImportIndex);

    expect(result.digital_release).toBeNull();
    expect(result.physical_release).toBeNull();
  });

  test('handles movie with no tags', () => {
    const movie = makeRadarrMovie({ tags: [] });
    const result = mapMovie(movie, tagMap, emptyImportIndex);
    expect(result.tags).toEqual([]);
  });

  test('handles movie with no file on disk', () => {
    const movie = makeRadarrMovie({ hasFile: false, sizeOnDisk: 0 });
    const result = mapMovie(movie, tagMap, emptyImportIndex);
    expect(result.size_on_disk).toBe(0);
    expect(result.has_file).toBe(false);
  });

  test('handles empty genres', () => {
    const movie = makeRadarrMovie({ genres: [] });
    const result = mapMovie(movie, tagMap, emptyImportIndex);
    expect(result.genres).toEqual([]);
  });

  test('handles null imdbId in source (not mapped to RadarrData)', () => {
    const movie = makeRadarrMovie({ imdbId: null });
    const result = mapMovie(movie, tagMap, emptyImportIndex);
    // imdbId is on UnifiedMovie, not RadarrData — mapMovie still works
    expect(result.status).toBe('released');
  });
});
