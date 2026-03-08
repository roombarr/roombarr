import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { AxiosError } from 'axios';
import type { FieldDefinition } from '../config/field-registry.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import type { EvaluationItemResult } from '../rules/types.js';
import {
  buildInternalId,
  type UnifiedMedia,
  type UnifiedMovie,
  type UnifiedSeason,
} from '../shared/types.js';
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

/** Creates a mock IntegrationProvider with executeAction capability. */
function makeProvider(
  name: string,
  executeAction: ReturnType<typeof mock> = mock(() => Promise.resolve()),
): IntegrationProvider {
  return {
    name,
    getFieldDefinitions: () => ({}) as Record<string, FieldDefinition>,
    validateConfig: () => [],
    executeAction,
  };
}

describe('ActionExecutorService', () => {
  let radarrExecuteAction: ReturnType<typeof mock>;
  let sonarrExecuteAction: ReturnType<typeof mock>;
  let service: ActionExecutorService;

  beforeEach(() => {
    radarrExecuteAction = mock(() => Promise.resolve());
    sonarrExecuteAction = mock(() => Promise.resolve());

    const radarrProvider = makeProvider('radarr', radarrExecuteAction);
    const sonarrProvider = makeProvider('sonarr', sonarrExecuteAction);

    service = new ActionExecutorService([radarrProvider, sonarrProvider]);
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
      expect(radarrExecuteAction).not.toHaveBeenCalled();
    });
  });

  describe('movie actions', () => {
    test('dispatches delete to movie provider', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results } = await service.execute([result], [movie], false);

      expect(radarrExecuteAction).toHaveBeenCalledWith(movie, 'delete');
      expect(results[0].execution_status).toBe('success');
    });

    test('dispatches unmonitor to movie provider', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'unmonitor');

      const { results } = await service.execute([result], [movie], false);

      expect(radarrExecuteAction).toHaveBeenCalledWith(movie, 'unmonitor');
      expect(results[0].execution_status).toBe('success');
    });
  });

  describe('season actions', () => {
    test('dispatches delete to season provider', async () => {
      const season = makeSeason();
      const result = makeResult(season, 'delete');

      const { results } = await service.execute([result], [season], false);

      expect(sonarrExecuteAction).toHaveBeenCalledWith(season, 'delete');
      expect(results[0].execution_status).toBe('success');
    });

    test('dispatches unmonitor to season provider', async () => {
      const season = makeSeason();
      const result = makeResult(season, 'unmonitor');

      const { results } = await service.execute([result], [season], false);

      expect(sonarrExecuteAction).toHaveBeenCalledWith(season, 'unmonitor');
      expect(results[0].execution_status).toBe('success');
    });
  });

  describe('keep actions', () => {
    test('skips execution for keep actions', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'keep');

      const { results } = await service.execute([result], [movie], false);

      expect(radarrExecuteAction).not.toHaveBeenCalled();
      expect(results[0].execution_status).toBe('skipped');
    });

    test('skips execution for null actions', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, null);

      const { results } = await service.execute([result], [movie], false);

      expect(radarrExecuteAction).not.toHaveBeenCalled();
      expect(results[0].execution_status).toBe('skipped');
    });
  });

  describe('error handling', () => {
    test('logs 404 as warning without counting as success or failure', async () => {
      radarrExecuteAction = mock(() => Promise.reject(make404Error()));
      const radarrProvider = makeProvider('radarr', radarrExecuteAction);
      service = new ActionExecutorService([radarrProvider]);

      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results, executionSummary } = await service.execute(
        [result],
        [movie],
        false,
      );

      expect(results).toHaveLength(1);
      expect(results[0].execution_status).toBe('not_found');
      expect(executionSummary?.actions_executed.delete).toBe(0);
      expect(executionSummary?.actions_failed).toBe(0);
    });

    test('continues executing after non-404 error', async () => {
      const movie1 = makeMovie({ radarr_id: 1, tmdb_id: 100 });
      const movie2 = makeMovie({ radarr_id: 2, tmdb_id: 200 });

      let callCount = 0;
      radarrExecuteAction = mock(() => {
        callCount++;
        if (callCount === 1)
          return Promise.reject(new Error('Internal Server Error'));
        return Promise.resolve();
      });
      const radarrProvider = makeProvider('radarr', radarrExecuteAction);
      service = new ActionExecutorService([radarrProvider]);

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
      expect(executed[0].execution_error).toBe('Failed to delete item');
      expect(executed[1].execution_status).toBe('success');
      expect(executionSummary?.actions_executed.delete).toBe(1);
      expect(executionSummary?.actions_failed).toBe(1);
    });

    test('includes not_found alongside successful items in mixed batch', async () => {
      const movie1 = makeMovie({ radarr_id: 1, tmdb_id: 100 });
      const movie2 = makeMovie({ radarr_id: 2, tmdb_id: 200 });

      let callCount = 0;
      radarrExecuteAction = mock(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(make404Error());
        return Promise.resolve();
      });
      const radarrProvider = makeProvider('radarr', radarrExecuteAction);
      service = new ActionExecutorService([radarrProvider]);

      const { results: executed, executionSummary } = await service.execute(
        [makeResult(movie1, 'delete'), makeResult(movie2, 'delete')],
        [movie1, movie2],
        false,
      );

      expect(executed).toHaveLength(2);
      expect(executed[0].execution_status).toBe('not_found');
      expect(executed[0].execution_error).toBeUndefined();
      expect(executed[1].execution_status).toBe('success');
      expect(executionSummary?.actions_executed.delete).toBe(1);
      expect(executionSummary?.actions_failed).toBe(0);
    });

    test('reports failure when item not found in hydrated data', async () => {
      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results } = await service.execute([result], [], false);

      expect(results[0].execution_status).toBe('failed');
      expect(results[0].execution_error).toBe(
        'Item not found in hydrated data',
      );
    });

    test('reports failure when no provider registered for item type', async () => {
      service = new ActionExecutorService([]);

      const movie = makeMovie();
      const result = makeResult(movie, 'delete');

      const { results } = await service.execute([result], [movie], false);

      expect(results[0].execution_status).toBe('failed');
      expect(results[0].execution_error).toBe(
        'No action provider registered for target "radarr"',
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
