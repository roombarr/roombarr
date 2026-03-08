import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { RadarrService } from './radarr.service.js';
import type {
  RadarrImportListMovie,
  RadarrMovie,
  RadarrTag,
} from './radarr.types.js';

function makeRadarrMovie(overrides: Partial<RadarrMovie> = {}): RadarrMovie {
  return {
    id: 1,
    title: 'Test Movie',
    tmdbId: 100,
    imdbId: 'tt0000100',
    year: 2024,
    path: '/movies/Test Movie',
    status: 'released',
    genres: ['action'],
    tags: [],
    monitored: true,
    hasFile: true,
    sizeOnDisk: 5_000_000_000,
    added: '2024-06-01T12:00:00Z',
    digitalRelease: null,
    physicalRelease: null,
    ...overrides,
  };
}

describe('RadarrService', () => {
  let client: {
    fetchMovies: ReturnType<typeof mock>;
    fetchTags: ReturnType<typeof mock>;
    fetchImportListMovies: ReturnType<typeof mock>;
  };
  let service: RadarrService;

  beforeEach(() => {
    client = {
      fetchMovies: mock(() => Promise.resolve([])),
      fetchTags: mock(() => Promise.resolve([])),
      fetchImportListMovies: mock(() => Promise.resolve([])),
    };
    service = new RadarrService(client as any);
  });

  test('fetches and maps movies to unified format', async () => {
    const movie = makeRadarrMovie();
    client.fetchMovies = mock(() => Promise.resolve([movie]));

    const result = await service.fetchMovies();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'movie',
      radarr_id: 1,
      tmdb_id: 100,
      imdb_id: 'tt0000100',
      title: 'Test Movie',
      year: 2024,
      jellyfin: null,
      jellyseerr: null,
      state: null,
    });
  });

  test('returns empty array when no movies exist', async () => {
    const result = await service.fetchMovies();

    expect(result).toEqual([]);
  });

  test('resolves tags via buildTagMap', async () => {
    const movie = makeRadarrMovie({ tags: [1, 2] });
    const tags: RadarrTag[] = [
      { id: 1, label: 'Watched' },
      { id: 2, label: 'Keep' },
    ];
    client.fetchMovies = mock(() => Promise.resolve([movie]));
    client.fetchTags = mock(() => Promise.resolve(tags));

    const result = await service.fetchMovies();

    expect(result[0].radarr.tags).toEqual(['watched', 'keep']);
  });

  test('handles fetchImportListMovies failure gracefully', async () => {
    const movie = makeRadarrMovie();
    client.fetchMovies = mock(() => Promise.resolve([movie]));
    client.fetchImportListMovies = mock(() =>
      Promise.reject(new Error('Endpoint not found')),
    );

    const result = await service.fetchMovies();

    expect(result).toHaveLength(1);
    expect(result[0].radarr.on_import_list).toBe(false);
    expect(result[0].radarr.import_list_ids).toEqual([]);
  });

  test('marks movies on import list correctly', async () => {
    const movie = makeRadarrMovie({ tmdbId: 200 });
    const importListMovies: RadarrImportListMovie[] = [
      { tmdbId: 200, lists: [5, 10], title: 'Test', isExisting: true },
    ];
    client.fetchMovies = mock(() => Promise.resolve([movie]));
    client.fetchImportListMovies = mock(() =>
      Promise.resolve(importListMovies),
    );

    const result = await service.fetchMovies();

    expect(result[0].radarr.on_import_list).toBe(true);
    expect(result[0].radarr.import_list_ids).toEqual([5, 10]);
  });

  test('handles multiple movies', async () => {
    const movies = [
      makeRadarrMovie({ id: 1, tmdbId: 100, title: 'Movie A' }),
      makeRadarrMovie({ id: 2, tmdbId: 200, title: 'Movie B' }),
      makeRadarrMovie({ id: 3, tmdbId: 300, title: 'Movie C' }),
    ];
    client.fetchMovies = mock(() => Promise.resolve(movies));

    const result = await service.fetchMovies();

    expect(result).toHaveLength(3);
    expect(result.map(m => m.tmdb_id)).toEqual([100, 200, 300]);
  });
});
