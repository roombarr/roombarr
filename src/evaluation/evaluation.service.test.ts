import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RoombarrConfig } from '../config/config.schema.js';
import type {
  EvaluationItemResult,
  EvaluationSummary,
} from '../rules/types.js';
import type { UnifiedMovie } from '../shared/types.js';
import { EvaluationService } from './evaluation.service.js';

const testConfig: RoombarrConfig = {
  services: {
    radarr: { base_url: 'http://radarr:7878', api_key: 'test' },
  },
  schedule: '0 3 * * *',
  performance: { concurrency: 10 },
  rules: [
    {
      name: 'Delete old movies',
      target: 'radarr',
      action: 'delete',
      conditions: {
        operator: 'AND',
        children: [
          { field: 'radarr.monitored', operator: 'equals', value: true },
        ],
      },
    },
  ],
};

const testMovie: UnifiedMovie = {
  type: 'movie',
  tmdb_id: 603,
  imdb_id: 'tt0133093',
  title: 'The Matrix (1999)',
  year: 1999,
  radarr: {
    added: '2024-01-01T00:00:00Z',
    size_on_disk: 5_000_000_000,
    monitored: true,
    tags: [],
    genres: ['action'],
    status: 'released',
    year: 1999,
    has_file: true,
    digital_release: null,
    physical_release: null,
    path: '/movies/The Matrix (1999)',
  },
  jellyfin: null,
  jellyseerr: null,
};

const testEvaluationResult: EvaluationItemResult = {
  title: 'The Matrix (1999)',
  type: 'movie',
  external_id: 603,
  matched_rules: ['Delete old movies'],
  resolved_action: 'delete',
  dry_run: true,
};

const testSummary: EvaluationSummary = {
  items_evaluated: 1,
  items_matched: 1,
  actions: { keep: 0, unmonitor: 0, delete: 1 },
  rules_skipped_missing_data: 0,
};

/** Let microtask queue drain so fire-and-forget promises complete. */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

describe('EvaluationService', () => {
  let configService: { getConfig: ReturnType<typeof mock> };
  let mediaService: { hydrate: ReturnType<typeof mock> };
  let rulesService: { evaluate: ReturnType<typeof mock> };
  let service: EvaluationService;

  beforeEach(() => {
    configService = {
      getConfig: mock(() => testConfig),
    };
    mediaService = {
      hydrate: mock(() => Promise.resolve([testMovie])),
    };
    rulesService = {
      evaluate: mock(() => ({
        results: [testEvaluationResult],
        summary: testSummary,
      })),
    };

    service = new EvaluationService(
      configService as any,
      mediaService as any,
      rulesService as any,
    );
  });

  describe('runEvaluation', () => {
    test('completes a full evaluation run', async () => {
      const run = await service.runEvaluation();

      expect(run.status).toBe('completed');
      expect(run.run_id).toBeTruthy();
      expect(run.started_at).toBeTruthy();
      expect(run.completed_at).toBeTruthy();
      expect(run.summary).toEqual(testSummary);
      expect(run.results).toHaveLength(1);
      expect(run.results[0].title).toBe('The Matrix (1999)');
      expect(mediaService.hydrate).toHaveBeenCalledTimes(1);
      expect(rulesService.evaluate).toHaveBeenCalledTimes(1);
    });

    test('filters out unmatched items from results', async () => {
      const unmatchedResult: EvaluationItemResult = {
        title: 'Unmatched Movie',
        type: 'movie',
        external_id: 999,
        matched_rules: [],
        resolved_action: null,
        dry_run: true,
      };
      rulesService.evaluate = mock(() => ({
        results: [testEvaluationResult, unmatchedResult],
        summary: testSummary,
      }));

      const run = await service.runEvaluation();

      // Only matched items should be in results
      expect(run.results).toHaveLength(1);
      expect(run.results[0].title).toBe('The Matrix (1999)');
    });

    test('marks run as failed when hydration throws', async () => {
      mediaService.hydrate = mock(() =>
        Promise.reject(new Error('Sonarr connection refused')),
      );

      const run = await service.runEvaluation();

      expect(run.status).toBe('failed');
      expect(run.error).toBe('Sonarr connection refused');
      expect(run.completed_at).toBeTruthy();
    });

    test('resets running flag after failure', async () => {
      mediaService.hydrate = mock(() =>
        Promise.reject(new Error('Network error')),
      );

      await service.runEvaluation();

      expect(service.isRunning()).toBe(false);
    });
  });

  describe('startEvaluation', () => {
    test('returns immediately with running status', () => {
      const run = service.startEvaluation();

      expect(run.status).toBe('running');
      expect(run.run_id).toBeTruthy();
      expect(run.started_at).toBeTruthy();
      expect(run.completed_at).toBeNull();
    });

    test('completes asynchronously', async () => {
      const run = service.startEvaluation();
      await tick();

      expect(run.status).toBe('completed');
      expect(run.summary).toEqual(testSummary);
    });

    test('sets isRunning to true during execution', () => {
      // Make hydration hang
      mediaService.hydrate = mock(() => new Promise(() => {}));

      service.startEvaluation();

      expect(service.isRunning()).toBe(true);
    });
  });

  describe('getRun', () => {
    test('retrieves a stored run by ID', async () => {
      const run = await service.runEvaluation();
      const retrieved = service.getRun(run.run_id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.run_id).toBe(run.run_id);
    });

    test('returns undefined for unknown run ID', () => {
      expect(service.getRun('nonexistent')).toBeUndefined();
    });

    test('evicts oldest runs when exceeding max stored', async () => {
      const runIds: string[] = [];

      // Create 11 runs (max is 10)
      for (let i = 0; i < 11; i++) {
        const run = await service.runEvaluation();
        runIds.push(run.run_id);
      }

      // First run should be evicted
      expect(service.getRun(runIds[0])).toBeUndefined();
      // Last run should still exist
      expect(service.getRun(runIds[10])).toBeDefined();
    });
  });

  describe('concurrency guard', () => {
    test('isRunning reflects current state', async () => {
      expect(service.isRunning()).toBe(false);

      mediaService.hydrate = mock(() => new Promise(() => {}));
      service.startEvaluation();

      expect(service.isRunning()).toBe(true);
    });
  });

  describe('handleCron', () => {
    test('skips when another evaluation is running', async () => {
      // Make hydration hang so the evaluation stays running
      mediaService.hydrate = mock(() => new Promise(() => {}));
      service.startEvaluation();

      // Cron should skip
      await service.handleCron();

      // hydrate should only have been called once (from startEvaluation)
      expect(mediaService.hydrate).toHaveBeenCalledTimes(1);
    });
  });

  describe('matchesCron (via handleCron)', () => {
    test('does not trigger when schedule does not match current time', async () => {
      // Schedule is "0 3 * * *" (3 AM) — unlikely to be current time in tests
      // We just verify it doesn't call hydrate for a non-matching time
      await service.handleCron();

      // If the current minute doesn't happen to be 3:00 AM,
      // hydrate should not be called
      const currentHour = new Date().getHours();
      const currentMinute = new Date().getMinutes();
      if (currentHour !== 3 || currentMinute !== 0) {
        expect(mediaService.hydrate).not.toHaveBeenCalled();
      }
    });
  });
});
