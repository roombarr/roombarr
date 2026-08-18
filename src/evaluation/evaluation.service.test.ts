import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EvaluationItemResult, EvaluationSummary } from '../rules/types';
import { makeConfig, makeMovie } from '../test/index';
import { EvaluationService } from './evaluation.service';

const testConfig = makeConfig();

const testMovie = makeMovie();

const testEvaluationResult: EvaluationItemResult = {
  title: 'Test Movie',
  type: 'movie',
  internal_id: 'movie:101',
  external_id: 1,
  matched_rules: ['Test rule'],
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
  let snapshotService: { snapshot: ReturnType<typeof mock> };
  let stateService: { enrich: ReturnType<typeof mock> };
  let actionExecutor: { execute: ReturnType<typeof mock> };
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
    snapshotService = {
      snapshot: mock(() => Promise.resolve()),
    };
    stateService = {
      enrich: mock((items: any) => items),
    };
    actionExecutor = {
      execute: mock((results: any) => Promise.resolve({ results })),
    };

    service = new EvaluationService(
      configService as any,
      mediaService as any,
      rulesService as any,
      snapshotService as any,
      stateService as any,
      actionExecutor as any,
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
      expect(run.results[0].title).toBe('Test Movie');
      expect(mediaService.hydrate).toHaveBeenCalledTimes(1);
      expect(rulesService.evaluate).toHaveBeenCalledTimes(1);
      expect(actionExecutor.execute).toHaveBeenCalledTimes(1);
      expect(actionExecutor.execute).toHaveBeenCalledWith(
        [testEvaluationResult],
        [testMovie],
        testConfig.dry_run,
        expect.any(Function),
      );
    });

    test('filters out unmatched items from results', async () => {
      const unmatchedResult: EvaluationItemResult = {
        title: 'Unmatched Movie',
        type: 'movie',
        internal_id: 'movie:999',
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
      expect(run.results[0].title).toBe('Test Movie');
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
      configService.getConfig = mock(() =>
        makeConfig({ schedule: '0 3 31 2 *' }),
      );
      await service.handleCron();
      expect(mediaService.hydrate).not.toHaveBeenCalled();
    });

    test('triggers evaluation when schedule matches current time', async () => {
      configService.getConfig = mock(() =>
        makeConfig({ schedule: '* * * * *' }),
      );
      await service.handleCron();
      expect(mediaService.hydrate).toHaveBeenCalledTimes(1);
    });
  });
  describe('evaluation deadline (safety.evaluation_timeout)', () => {
    test('releases the scheduler when hydrate never settles', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          safety: { evaluation_timeout: '50ms', max_deletes_per_run: 50 },
        }),
      );
      // A promise that never settles — the production wedge, reproduced.
      mediaService.hydrate = mock(() => new Promise(() => {}));

      const run = await service.runEvaluation();

      expect(service.isRunning()).toBe(false);
      expect(run.status).toBe('failed');
      expect(run.error).toContain('50ms');
    });

    test('a later cron run proceeds after a timed-out run', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          schedule: '* * * * *',
          safety: { evaluation_timeout: '50ms', max_deletes_per_run: 50 },
        }),
      );
      mediaService.hydrate = mock(() => new Promise(() => {}));
      await service.handleCron();
      expect(service.isRunning()).toBe(false);

      mediaService.hydrate = mock(() => Promise.resolve([testMovie]));
      await service.handleCron();
      expect(mediaService.hydrate).toHaveBeenCalledTimes(1);
    });

    /**
     * A pipeline step the test holds open. Nothing but `release` can settle it,
     * so "the deadline fires first" is a fixed ordering rather than a race
     * between two wall-clock timers on a loaded machine.
     */
    function heldStep<T>(): {
      promise: Promise<T>;
      release: (value: T) => void;
    } {
      let resolveStep: (value: T) => void = () => {};
      const promise = new Promise<T>(resolve => {
        resolveStep = resolve;
      });
      return { promise, release: value => resolveStep(value) };
    }

    test('does not execute actions for a run that already timed out', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          safety: { evaluation_timeout: '30ms', max_deletes_per_run: 50 },
        }),
      );
      const hydrate = heldStep<any>();
      mediaService.hydrate = mock(() => hydrate.promise);

      const run = await service.runEvaluation();
      expect(run.status).toBe('failed');

      hydrate.release([testMovie]);
      await tick();

      expect(actionExecutor.execute).not.toHaveBeenCalled();
    });

    test('does not snapshot for a run that already timed out', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          safety: { evaluation_timeout: '30ms', max_deletes_per_run: 50 },
        }),
      );
      const hydrate = heldStep<any>();
      mediaService.hydrate = mock(() => hydrate.promise);

      await service.runEvaluation();

      hydrate.release([testMovie]);
      await tick();

      expect(snapshotService.snapshot).not.toHaveBeenCalled();
    });

    test('does not evaluate rules when the deadline elapses during the snapshot', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          safety: { evaluation_timeout: '30ms', max_deletes_per_run: 50 },
        }),
      );
      const snapshot = heldStep<void>();
      snapshotService.snapshot = mock(() => snapshot.promise);

      const run = await service.runEvaluation();
      expect(run.status).toBe('failed');

      // The snapshot rows land regardless — but rule evaluation writes audit
      // entries, and an abandoned run must not leave an audit trail behind.
      snapshot.release();
      await tick();

      expect(snapshotService.snapshot).toHaveBeenCalledTimes(1);
      expect(rulesService.evaluate).not.toHaveBeenCalled();
      expect(stateService.enrich).not.toHaveBeenCalled();
      expect(actionExecutor.execute).not.toHaveBeenCalled();
      expect(run.status).toBe('failed');
      expect(run.results).toEqual([]);
    });

    test('does not report completed when the deadline elapses mid-execution', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          safety: { evaluation_timeout: '30ms', max_deletes_per_run: 50 },
        }),
      );
      const execute = heldStep<any>();
      actionExecutor.execute = mock((results: any) =>
        execute.promise.then(() => ({ results })),
      );

      const run = await service.runEvaluation();
      expect(run.status).toBe('failed');

      execute.release(null);
      await tick();

      expect(run.status).toBe('failed');
      expect(run.results).toEqual([]);
    });

    test('tells the executor to stop once the run is abandoned', async () => {
      configService.getConfig = mock(() =>
        makeConfig({
          safety: { evaluation_timeout: '30ms', max_deletes_per_run: 50 },
        }),
      );

      let isAbandoned: (() => boolean) | undefined;
      const execute = heldStep<any>();
      actionExecutor.execute = mock(
        (results: any, _items: any, _dryRun: any, abandoned: () => boolean) => {
          isAbandoned = abandoned;
          return execute.promise.then(() => ({ results }));
        },
      );

      const run = await service.runEvaluation();
      expect(run.status).toBe('failed');

      // The executor is still mid-queue here; its next poll must say stop.
      expect(isAbandoned?.()).toBe(true);

      execute.release(null);
      await tick();
    });

    test('carries an execution abort reason into the run summary', async () => {
      actionExecutor.execute = mock((results: any) =>
        Promise.resolve({
          results,
          executionSummary: {
            actions_executed: { keep: 0, unmonitor: 0, delete: 0 },
            actions_failed: 0,
            aborted_reason: 'max_deletes_per_run_exceeded' as const,
          },
        }),
      );

      const run = await service.runEvaluation();

      expect(run.status).toBe('completed');
      expect(run.summary?.aborted_reason).toBe('max_deletes_per_run_exceeded');
    });

    test('completes normally when within the deadline', async () => {
      const run = await service.runEvaluation();
      expect(run.status).toBe('completed');
      expect(service.isRunning()).toBe(false);
    });
  });
});
