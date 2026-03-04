import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { AxiosError } from 'axios';
import type { RadarrClient } from '../radarr/radarr.client.js';
import type { EvaluationItemResult } from '../rules/types.js';
import {
  buildInternalId,
  type UnifiedMedia,
  type UnifiedMovie,
  type UnifiedSeason,
} from '../shared/types.js';
import type { SonarrClient } from '../sonarr/sonarr.client.js';
import { ActionExecutorService } from './action-executor.service.js';

function makeMovie(overrides: Record<string, any> = {}): UnifiedMovie {
  return {
    type: 'movie',
    radarr_id: 42,
    tmdb_id: 603,
    imdb_id: 'tt0133093',
    title: 'The Matrix',
    year: 1999,
    radarr: {
      added: '2024-01-01T00:00:00Z',
      size_on_disk: 8_500_000_000,
      has_file: true,
      monitored: true,
      tags: [],
      genres: ['action'],
      status: 'released',
      year: 1999,
      digital_release: null,
      physical_release: null,
      path: '/movies/The Matrix',
      on_import_list: false,
      import_list_ids: [],
    },
    state: null,
    jellyfin: null,
    jellyseerr: null,
    ...overrides,
  };
}

function makeSeason(overrides: Record<string, any> = {}): UnifiedSeason {
  return {
    type: 'season',
    sonarr_series_id: 10,
    tvdb_id: 100,
    title: 'Breaking Bad - S01',
    year: 2008,
    sonarr: {
      tags: [],
      genres: ['drama'],
      status: 'ended',
      year: 2008,
      path: '/tv/Breaking Bad',
      season: {
        season_number: 1,
        monitored: true,
        episode_count: 7,
        episode_file_count: 7,
        has_file: true,
        size_on_disk: 10_000_000_000,
      },
    },
    state: null,
    jellyfin: null,
    jellyseerr: null,
    ...overrides,
  };
}

function makeResult(
  item: UnifiedMedia,
  action: 'delete' | 'unmonitor' | 'keep' | null,
): EvaluationItemResult {
  return {
    title: item.title,
    type: item.type,
    internal_id: buildInternalId(item),
    external_id: item.type === 'movie' ? item.tmdb_id : item.tvdb_id,
    matched_rules: action ? ['test-rule'] : [],
    resolved_action: action,
    dry_run: false,
  };
}

function make404Error(): AxiosError {
  const error = new AxiosError('Not Found');
  error.response = {
    status: 404,
    statusText: 'Not Found',
    headers: {},
    config: {} as any,
    data: {},
  };
  return error;
}

describe('ActionExecutorService', () => {
  let radarrClient: {
    deleteMovie: ReturnType<typeof mock>;
    fetchMovie: ReturnType<typeof mock>;
    updateMovie: ReturnType<typeof mock>;
  };
  let sonarrClient: {
    fetchEpisodeFiles: ReturnType<typeof mock>;
    deleteEpisodeFile: ReturnType<typeof mock>;
    fetchSeriesById: ReturnType<typeof mock>;
    updateSeries: ReturnType<typeof mock>;
  };
  let service: ActionExecutorService;

  beforeEach(() => {
    radarrClient = {
      deleteMovie: mock(() => Promise.resolve()),
      fetchMovie: mock(() =>
        Promise.resolve({
          id: 42,
          title: 'The Matrix',
          tmdbId: 603,
          imdbId: 'tt0133093',
          year: 1999,
          path: '/movies/The Matrix',
          status: 'released',
          genres: ['action'],
          tags: [],
          monitored: true,
          sizeOnDisk: 8_500_000_000,
          added: '2024-01-01T00:00:00Z',
          digitalRelease: null,
          physicalRelease: null,
        }),
      ),
      updateMovie: mock(() => Promise.resolve()),
    };
    sonarrClient = {
      fetchEpisodeFiles: mock(() =>
        Promise.resolve([
          {
            id: 1,
            seriesId: 10,
            seasonNumber: 1,
            path: '/ep1.mkv',
            size: 1_000_000_000,
          },
          {
            id: 2,
            seriesId: 10,
            seasonNumber: 1,
            path: '/ep2.mkv',
            size: 1_000_000_000,
          },
          {
            id: 3,
            seriesId: 10,
            seasonNumber: 2,
            path: '/ep3.mkv',
            size: 1_000_000_000,
          },
        ]),
      ),
      deleteEpisodeFile: mock(() => Promise.resolve()),
      fetchSeriesById: mock(() =>
        Promise.resolve({
          id: 10,
          title: 'Breaking Bad',
          tvdbId: 100,
          imdbId: null,
          year: 2008,
          path: '/tv/Breaking Bad',
          status: 'ended',
          genres: ['drama'],
          tags: [],
          monitored: true,
          seasons: [
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
        }),
      ),
      updateSeries: mock(() => Promise.resolve()),
    };

    service = new ActionExecutorService(
      radarrClient as unknown as RadarrClient,
      sonarrClient as unknown as SonarrClient,
    );
  });

  describe('dry-run mode', () => {
    test('marks all results as skipped when dry_run is true', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results, executionSummary } = await service.execute(
        [result],
        [movie],
        true,
      );

      expect(results[0].execution_status).toBe('skipped');
      expect(executionSummary).toBeUndefined();
      expect(radarrClient.deleteMovie).not.toHaveBeenCalled();
    });
  });

  describe('Radarr delete', () => {
    test('calls deleteMovie with radarr_id', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results } = await service.execute([result], [movie], false);

      expect(radarrClient.deleteMovie).toHaveBeenCalledWith(42);
      expect(results[0].execution_status).toBe('success');
    });
  });

  describe('Radarr unmonitor', () => {
    test('re-fetches movie and PUTs with monitored: false', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'unmonitor');

      const { results } = await service.execute([result], [movie], false);

      expect(radarrClient.fetchMovie).toHaveBeenCalledWith(42);
      expect(radarrClient.updateMovie).toHaveBeenCalledTimes(1);
      const putBody = radarrClient.updateMovie.mock.calls[0][1];
      expect(putBody.monitored).toBe(false);
      expect(results[0].execution_status).toBe('success');
    });
  });

  describe('Sonarr season delete', () => {
    test('fetches episode files, filters by season, deletes each', async () => {
      const season = makeSeason();
      const result = makeResult(season, 'delete');

      const { results } = await service.execute([result], [season], false);

      expect(sonarrClient.fetchEpisodeFiles).toHaveBeenCalledWith(10);
      // Only season 1 files (ids 1 and 2), not season 2 (id 3)
      expect(sonarrClient.deleteEpisodeFile).toHaveBeenCalledTimes(2);
      expect(sonarrClient.deleteEpisodeFile).toHaveBeenCalledWith(1);
      expect(sonarrClient.deleteEpisodeFile).toHaveBeenCalledWith(2);
      expect(results[0].execution_status).toBe('success');
    });

    test('handles season with no episode files gracefully', async () => {
      sonarrClient.fetchEpisodeFiles = mock(() => Promise.resolve([]));
      const season = makeSeason();
      const result = makeResult(season, 'delete');

      const { results } = await service.execute([result], [season], false);

      expect(sonarrClient.deleteEpisodeFile).not.toHaveBeenCalled();
      expect(results[0].execution_status).toBe('success');
    });
  });

  describe('Sonarr season unmonitor', () => {
    test('re-fetches series and PUTs with season monitored: false', async () => {
      const season = makeSeason();
      const result = makeResult(season, 'unmonitor');

      const { results } = await service.execute([result], [season], false);

      expect(sonarrClient.fetchSeriesById).toHaveBeenCalledWith(10);
      expect(sonarrClient.updateSeries).toHaveBeenCalledTimes(1);
      const putBody = sonarrClient.updateSeries.mock.calls[0][1];
      expect(putBody.seasons[0].monitored).toBe(false);
      expect(putBody.seasons[1].monitored).toBe(true); // season 2 unchanged
      expect(results[0].execution_status).toBe('success');
    });
  });

  describe('keep actions', () => {
    test('skips execution for keep actions', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'keep');

      const { results } = await service.execute([result], [movie], false);

      expect(radarrClient.deleteMovie).not.toHaveBeenCalled();
      expect(radarrClient.fetchMovie).not.toHaveBeenCalled();
      expect(results[0].execution_status).toBe('skipped');
    });

    test('skips execution for null actions', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, null);

      const { results } = await service.execute([result], [movie], false);

      expect(radarrClient.deleteMovie).not.toHaveBeenCalled();
      expect(results[0].execution_status).toBe('skipped');
    });
  });

  describe('error handling', () => {
    test('logs 404 as warning without counting as success or failure', async () => {
      radarrClient.deleteMovie = mock(() => Promise.reject(make404Error()));
      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results, executionSummary } = await service.execute(
        [result],
        [movie],
        false,
      );

      expect(results).toHaveLength(0);
      expect(executionSummary?.actions_executed.delete).toBe(0);
      expect(executionSummary?.actions_failed).toBe(0);
    });

    test('continues executing after non-404 error', async () => {
      const movie1 = makeMovie({ radarr_id: 1, tmdb_id: 100 });
      const movie2 = makeMovie({ radarr_id: 2, tmdb_id: 200 });

      // First call fails with 500, second succeeds
      let callCount = 0;
      radarrClient.deleteMovie = mock(() => {
        callCount++;
        if (callCount === 1)
          return Promise.reject(new Error('Internal Server Error'));
        return Promise.resolve();
      });

      const results = [
        makeResult(movie1, 'delete'),
        makeResult(movie2, 'delete'),
      ];

      const { results: executed, executionSummary } = await service.execute(
        results,
        [movie1, movie2],
        false,
      );

      expect(executed[0].execution_status).toBe('failed');
      expect(executed[0].execution_error).toBe('Internal Server Error');
      expect(executed[1].execution_status).toBe('success');
      expect(executionSummary?.actions_executed.delete).toBe(1);
      expect(executionSummary?.actions_failed).toBe(1);
    });

    test('reports failure when item not found in hydrated data', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      // Pass empty items array — item won't be found
      const { results } = await service.execute([result], [], false);

      expect(results[0].execution_status).toBe('failed');
      expect(results[0].execution_error).toBe(
        'Item not found in hydrated data',
      );
    });
  });

  describe('execution summary', () => {
    test('tracks counts across multiple actions', async () => {
      const movie1 = makeMovie({ radarr_id: 1, tmdb_id: 100 });
      const movie2 = makeMovie({ radarr_id: 2, tmdb_id: 200 });
      const season = makeSeason();

      const results = [
        makeResult(movie1, 'delete'),
        makeResult(movie2, 'unmonitor'),
        makeResult(season, 'delete'),
      ];

      const { executionSummary } = await service.execute(
        results,
        [movie1, movie2, season],
        false,
      );

      expect(executionSummary).toBeDefined();
      expect(executionSummary?.actions_executed.delete).toBe(2);
      expect(executionSummary?.actions_executed.unmonitor).toBe(1);
      expect(executionSummary?.actions_failed).toBe(0);
    });
  });
});
