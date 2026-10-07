import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { Logger } from '@nestjs/common';
import {
  createMockSnapshotService,
  createPassThroughImportListGuard,
  makeRadarrMovie,
} from '../test/index';
import { RadarrService } from './radarr.service';
import type { RadarrImportListMovie, RadarrTag } from './radarr.types';

describe('RadarrService', () => {
  let client: {
    fetchMovies: ReturnType<typeof mock>;
    fetchTags: ReturnType<typeof mock>;
    fetchImportListMovies: ReturnType<typeof mock>;
    fetchImportLists: ReturnType<typeof mock>;
  };
  let service: RadarrService;

  beforeEach(() => {
    client = {
      fetchMovies: mock(() => Promise.resolve([])),
      fetchTags: mock(() => Promise.resolve([])),
      fetchImportListMovies: mock(() => Promise.resolve([])),
      fetchImportLists: mock(() => Promise.resolve([])),
    };
    service = new RadarrService(
      client as any,
      createMockSnapshotService(),
      createPassThroughImportListGuard(),
    );
  });

  afterEach(() => {
    mock.restore();
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

  test('holds last recorded membership when the import-list fetch fails', async () => {
    client.fetchMovies = mock(() =>
      Promise.resolve([
        makeRadarrMovie({ id: 1, tmdbId: 100 }),
        makeRadarrMovie({ id: 2, tmdbId: 200 }),
      ]),
    );
    client.fetchImportListMovies = mock(() =>
      Promise.reject(new Error('Request failed with status code 503')),
    );
    service = new RadarrService(
      client as any,
      createMockSnapshotService(new Map([[100, [5, 10]]])),
      createPassThroughImportListGuard(),
    );

    const result = await service.fetchMovies();

    expect(result).toHaveLength(1);
    expect(result[0].radarr.on_import_list).toBe(true);
    expect(result[0].radarr.import_list_ids).toEqual([5, 10]);
  });

  test('holds a recorded empty membership as off every list', async () => {
    client.fetchMovies = mock(() =>
      Promise.resolve([makeRadarrMovie({ tmdbId: 100 })]),
    );
    client.fetchImportListMovies = mock(() =>
      Promise.reject(new Error('Request failed with status code 503')),
    );
    service = new RadarrService(
      client as any,
      createMockSnapshotService(new Map([[100, []]])),
      createPassThroughImportListGuard(),
    );

    const result = await service.fetchMovies();

    expect(result).toHaveLength(1);
    expect(result[0].radarr.on_import_list).toBe(false);
  });

  test('logs the import-list failure as an error naming the held membership', async () => {
    const errorSpy = spyOn(Logger.prototype, 'error').mockImplementation(
      () => {},
    );
    client.fetchImportListMovies = mock(() =>
      Promise.reject(new Error('Request failed with status code 503')),
    );

    await service.fetchMovies();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(message).toContain('holding');
    expect(message).toContain('skipping 0 movies');
    expect(message).toContain('Request failed with status code 503');
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
