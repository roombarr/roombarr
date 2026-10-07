import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';
import { Logger } from '@nestjs/common';
import type { RoombarrConfig, RuleConfig } from '../config/config.schema';
import { getHydratedServices } from '../config/field-registry';
import { fieldChanges } from '../database/schema';
import { ActionExecutorService } from '../execution/action-executor.service';
import { MediaService } from '../media/media.service';
import { ImportListGuardService } from '../radarr/import-list-guard.service';
import { RadarrClient } from '../radarr/radarr.client';
import { RadarrService } from '../radarr/radarr.service';
import { RulesService } from '../rules/rules.service';
import type { EvaluationItemResult } from '../rules/types';
import type { UnifiedMedia } from '../shared/types';
import { SnapshotService } from '../snapshot/snapshot.service';
import { StateService } from '../snapshot/state.service';
import {
  createMockRadarrClient,
  createMockSonarrClient,
  makeConfig,
  makeRadarrMovie,
  makeRule,
  useTestDatabase,
} from '../test/index';

function createMockAuditService() {
  return { logAction: mock() };
}

describe('full evaluation pipeline (e2e)', () => {
  const db = useTestDatabase();
  let mockRadarrClient: RadarrClient;
  let mockAuditService: ReturnType<typeof createMockAuditService>;
  let mediaService: MediaService;
  let snapshotService: SnapshotService;
  let stateService: StateService;
  let rulesService: RulesService;
  let actionExecutor: ActionExecutorService;
  let importListGuard: ImportListGuardService;
  let config: RoombarrConfig;

  /**
   * Construct every service against the test database. Calling it again
   * mid-test simulates a restart: only what's persisted carries over.
   */
  function startServices() {
    const configService = { getConfig: () => config } as any;
    snapshotService = new SnapshotService(db.dbService);
    importListGuard = new ImportListGuardService(
      db.dbService,
      configService,
      snapshotService,
    );
    const radarrService = new RadarrService(
      mockRadarrClient,
      snapshotService,
      importListGuard,
    );
    mediaService = new MediaService(null, radarrService, null, null);
    stateService = new StateService(db.dbService);
    rulesService = new RulesService(mockAuditService as any);
    actionExecutor = new ActionExecutorService(
      mockRadarrClient,
      createMockSonarrClient(),
      configService,
    );
  }

  beforeEach(() => {
    mockRadarrClient = createMockRadarrClient();
    mockAuditService = createMockAuditService();
    config = makeConfig();
    (
      mockRadarrClient.fetchImportLists as ReturnType<typeof mock>
    ).mockResolvedValue([{ id: 7, name: 'Trakt Watchlist', enabled: true }]);
    startServices();
  });

  /**
   * Run the full pipeline: hydrate → snapshot → enrich → evaluate → execute → filter.
   * Mirrors the step ordering in EvaluationService.executeEvaluation().
   */
  async function runPipeline(
    rules: RuleConfig[],
    dryRun = true,
  ): Promise<{
    allResults: EvaluationItemResult[];
    filteredResults: EvaluationItemResult[];
    summary: ReturnType<RulesService['evaluate']>['summary'];
    enrichedItems: UnifiedMedia[];
  }> {
    const evaluationId = 'e2e-test-run';

    // Step 1: Hydrate
    const items = await mediaService.hydrate(rules);

    // Step 2: Snapshot
    const hydratedServices = getHydratedServices(rules);
    await snapshotService.snapshot(items, hydratedServices);

    // Step 3: Enrich
    const enrichedItems = stateService.enrich(items);

    // Step 4: Evaluate
    const { results, summary } = rulesService.evaluate({
      items: enrichedItems,
      rules,
      evaluationId,
      dryRun,
      safety: { protect_airing_seasons: true },
    });

    // Step 5: Execute
    const { results: executedResults, executionSummary } =
      await actionExecutor.execute({
        results,
        items: enrichedItems,
        dryRun,
      });

    if (executionSummary) {
      summary.actions_executed = executionSummary.actions_executed;
      summary.actions_failed = executionSummary.actions_failed;
    }

    // Step 6: Filter (same as EvaluationService)
    const filteredResults = executedResults.filter(
      r => r.resolved_action !== null,
    );

    return {
      allResults: executedResults,
      filteredResults,
      summary,
      enrichedItems,
    };
  }

  test('dry-run — movie matches delete rule → execution_status: skipped', async () => {
    (mockRadarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue(
      [makeRadarrMovie({ title: 'E2E Movie', monitored: true })],
    );
    (mockRadarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue(
      [],
    );
    (
      mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([]);

    const rules: RuleConfig[] = [
      makeRule({
        name: 'Delete monitored',
        target: 'radarr',
        action: 'delete',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    const { filteredResults } = await runPipeline(rules);

    expect(filteredResults).toHaveLength(1);

    const result = filteredResults[0];
    expect(result.resolved_action).toBe('delete');
    expect(result.execution_status).toBe('skipped');
    expect(result.dry_run).toBe(true);
    expect(result.title).toBe('E2E Movie');

    // Destructive action triggers audit
    expect(mockAuditService.logAction).toHaveBeenCalledTimes(1);
  });

  test('movie not matching any rule → filtered out of results', async () => {
    (mockRadarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue(
      [makeRadarrMovie({ monitored: false })],
    );
    (mockRadarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue(
      [],
    );
    (
      mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([]);

    const rules: RuleConfig[] = [
      makeRule({
        name: 'Delete monitored',
        target: 'radarr',
        action: 'delete',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    const { allResults, filteredResults, summary } = await runPipeline(rules);

    // Raw results show null action
    expect(allResults).toHaveLength(1);
    expect(allResults[0].resolved_action).toBeNull();

    // Filtered results exclude non-matching items
    expect(filteredResults).toHaveLength(0);

    // Summary reflects correct counts
    expect(summary.items_evaluated).toBe(1);
    expect(summary.items_matched).toBe(0);
  });

  test('keep rule overrides delete rule → resolved_action: keep', async () => {
    (mockRadarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue(
      [makeRadarrMovie({ monitored: true, hasFile: true })],
    );
    (mockRadarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue(
      [],
    );
    (
      mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([]);

    const rules: RuleConfig[] = [
      makeRule({
        name: 'Delete monitored',
        target: 'radarr',
        action: 'delete',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
      makeRule({
        name: 'Keep with file',
        target: 'radarr',
        action: 'keep',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.has_file', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    const { filteredResults } = await runPipeline(rules);

    expect(filteredResults).toHaveLength(1);

    const result = filteredResults[0];
    expect(result.resolved_action).toBe('keep');
    expect(result.matched_rules).toContain('Delete monitored');
    expect(result.matched_rules).toContain('Keep with file');

    // Keep-override triggers audit with action: 'keep'
    expect(mockAuditService.logAction).toHaveBeenCalledTimes(1);
    expect(mockAuditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'keep' }),
    );
  });

  test('summary counts are correct across multiple items', async () => {
    (mockRadarrClient.fetchMovies as ReturnType<typeof mock>).mockResolvedValue(
      [
        makeRadarrMovie({
          id: 1,
          tmdbId: 100,
          title: 'Movie A',
          monitored: true,
          hasFile: true,
        }),
        makeRadarrMovie({
          id: 2,
          tmdbId: 200,
          title: 'Movie B',
          monitored: false,
          hasFile: false,
        }),
        makeRadarrMovie({
          id: 3,
          tmdbId: 300,
          title: 'Movie C',
          monitored: true,
          hasFile: false,
        }),
      ],
    );
    (mockRadarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue(
      [],
    );
    (
      mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
    ).mockResolvedValue([]);

    const rules: RuleConfig[] = [
      makeRule({
        name: 'Delete monitored',
        target: 'radarr',
        action: 'delete',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
      makeRule({
        name: 'Keep with file',
        target: 'radarr',
        action: 'keep',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.has_file', operator: 'equals', value: true },
          ],
        },
      }),
    ];

    const { filteredResults, summary } = await runPipeline(rules);

    // Movie A: monitored + has_file → matches both → keep wins
    // Movie B: not monitored, no file → matches nothing → filtered out
    // Movie C: monitored, no file → matches delete only
    expect(summary.items_evaluated).toBe(3);
    expect(summary.items_matched).toBe(2);
    expect(summary.actions).toEqual({ keep: 1, delete: 1, unmonitor: 0 });

    // Filtered results exclude Movie B
    expect(filteredResults).toHaveLength(2);

    const titles = filteredResults.map(r => r.title);
    expect(titles).toContain('Movie A');
    expect(titles).toContain('Movie C');
  });

  describe('import-list membership', () => {
    const onListMovie = makeRadarrMovie({
      id: 1,
      tmdbId: 100,
      title: 'Listed Movie',
      monitored: true,
    });

    const rules: RuleConfig[] = [
      makeRule({
        name: 'Delete monitored',
        target: 'radarr',
        action: 'delete',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.monitored', operator: 'equals', value: true },
          ],
        },
      }),
      makeRule({
        name: 'Keep listed',
        target: 'radarr',
        action: 'keep',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.on_import_list',
              operator: 'equals',
              value: true,
            },
          ],
        },
      }),
    ];

    /** Seed one healthy run in which the movie is on import list 7. */
    async function seedRunWithMovieOnList() {
      (
        mockRadarrClient.fetchMovies as ReturnType<typeof mock>
      ).mockResolvedValue([onListMovie]);
      (mockRadarrClient.fetchTags as ReturnType<typeof mock>).mockResolvedValue(
        [],
      );
      (
        mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
      ).mockResolvedValue([
        { tmdbId: 100, lists: [7], title: 'Listed Movie', isExisting: true },
      ]);
      await runPipeline(rules);
    }

    function failImportListFetch() {
      (
        mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
      ).mockRejectedValue(new Error('Request failed with status code 503'));
    }

    function importListChanges() {
      return db.drizzle
        .select()
        .from(fieldChanges)
        .all()
        .filter(c => c.fieldPath.includes('import_list'));
    }

    test('failed fetch: a movie on a list last run is still kept by an import-list keep rule', async () => {
      await seedRunWithMovieOnList();
      failImportListFetch();

      const { filteredResults } = await runPipeline(rules);

      expect(filteredResults).toHaveLength(1);
      expect(filteredResults[0].resolved_action).toBe('keep');
    });

    test('failed fetch: no import-list field changes are recorded', async () => {
      await seedRunWithMovieOnList();
      failImportListFetch();

      await runPipeline(rules);

      expect(importListChanges()).toEqual([]);
    });

    test('failed fetch: days_off_import_list stays null for a movie that was on a list', async () => {
      await seedRunWithMovieOnList();
      failImportListFetch();

      const { enrichedItems } = await runPipeline(rules);

      expect(enrichedItems[0].state?.days_off_import_list).toBeNull();
    });

    test('failed fetch: a movie with no recorded membership is left out of the run', async () => {
      await seedRunWithMovieOnList();
      failImportListFetch();
      (
        mockRadarrClient.fetchMovies as ReturnType<typeof mock>
      ).mockResolvedValue([
        onListMovie,
        makeRadarrMovie({ id: 2, tmdbId: 200, title: 'New Movie' }),
      ]);

      const { allResults } = await runPipeline(rules);

      expect(allResults.map(r => r.title)).toEqual(['Listed Movie']);
    });

    test('with the guard off, a successful fetch returning no movies takes the movie off its list', async () => {
      config = makeConfig({
        safety: { ...config.safety, hold_collapsed_import_lists: false },
      });
      await seedRunWithMovieOnList();
      (
        mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
      ).mockResolvedValue([]);

      const { filteredResults, enrichedItems } = await runPipeline(rules);

      expect(filteredResults[0].resolved_action).toBe('delete');
      expect(enrichedItems[0].state?.days_off_import_list).toBe(0);
      const changedPaths = importListChanges().map(c => c.fieldPath);
      expect(changedPaths).toContain('radarr.on_import_list');
      expect(
        changedPaths.some(p => p.startsWith('radarr.import_list_ids')),
      ).toBe(true);
    });

    describe('collapse guard', () => {
      const listedMovies = [100, 200, 300, 400].map(tmdbId =>
        makeRadarrMovie({
          id: tmdbId,
          tmdbId,
          title: `Listed ${tmdbId}`,
          monitored: true,
        }),
      );
      const DAY = 24 * 60 * 60 * 1000;
      const START = new Date('2026-10-01T03:00:00.000Z');
      const day = (n: number) => new Date(START.getTime() + n * DAY);

      let warnSpy: ReturnType<typeof spyOn>;

      beforeEach(() => {
        setSystemTime(START);
        warnSpy = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
        (
          mockRadarrClient.fetchMovies as ReturnType<typeof mock>
        ).mockResolvedValue(listedMovies);
        (
          mockRadarrClient.fetchTags as ReturnType<typeof mock>
        ).mockResolvedValue([]);
      });

      afterEach(() => {
        setSystemTime();
        mock.restore();
      });

      /** Have Radarr report list 7 holding exactly these movies. */
      function reportList(tmdbIds: number[]) {
        (
          mockRadarrClient.fetchImportListMovies as ReturnType<typeof mock>
        ).mockResolvedValue(
          tmdbIds.map(tmdbId => ({
            tmdbId,
            lists: [7],
            title: `Listed ${tmdbId}`,
            isExisting: true,
          })),
        );
      }

      async function runOn(n: number) {
        setSystemTime(day(n));
        return runPipeline(rules);
      }

      function actions(results: EvaluationItemResult[]) {
        return Object.fromEntries(
          results.map(r => [r.title, r.resolved_action]),
        );
      }

      function daysOff(items: UnifiedMedia[]) {
        return items.map(item => item.state?.days_off_import_list ?? null);
      }

      test('a list that empties keeps its movies on it, records no change, and warns how to acknowledge', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([]);

        const { allResults, enrichedItems } = await runOn(1);

        expect(new Set(Object.values(actions(allResults)))).toEqual(
          new Set(['keep']),
        );
        expect(
          enrichedItems.every(item =>
            item.type === 'movie' ? item.radarr.on_import_list : false,
          ),
        ).toBe(true);
        expect(daysOff(enrichedItems)).toEqual([null, null, null, null]);
        expect(importListChanges()).toEqual([]);

        const warnings = warnSpy.mock.calls.map(([message]) => String(message));
        const holdWarning = warnings.find(m => m.includes('Trakt Watchlist'));
        expect(holdWarning).toContain('(id 7)');
        expect(holdWarning).toContain('0 of its 4 movies');
        expect(holdWarning).toContain('/import-lists/7/acknowledge');
      });

      test('a list Radarr paused, then resumed, releases its hold on its own with no history recorded', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([]);
        await runOn(1);
        await runOn(2);
        reportList([100, 200, 300, 400]);

        const recovered = await runOn(3);
        warnSpy.mockClear();
        const after = await runOn(4);

        expect(new Set(Object.values(actions(recovered.allResults)))).toEqual(
          new Set(['keep']),
        );
        expect(daysOff(after.enrichedItems)).toEqual([null, null, null, null]);
        expect(importListChanges()).toEqual([]);
        const warnings = warnSpy.mock.calls.map(([message]) => String(message));
        expect(warnings.some(m => m.includes('Trakt Watchlist'))).toBe(false);
        expect(importListGuard.acknowledge(7)).toBe('not_held');
      });

      test('an empty list stays held across runs and a restart', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([]);
        await runOn(1);
        await runOn(2);
        startServices();

        const { allResults, enrichedItems } = await runOn(10);

        expect(new Set(Object.values(actions(allResults)))).toEqual(
          new Set(['keep']),
        );
        expect(daysOff(enrichedItems)).toEqual([null, null, null, null]);
        expect(importListChanges()).toEqual([]);
      });

      test('first run with the guard: a list the snapshot has movies on is held when it reports empty', async () => {
        config = makeConfig({
          safety: { ...config.safety, hold_collapsed_import_lists: false },
        });
        reportList([100, 200, 300, 400]);
        await runOn(0);
        config = makeConfig();
        startServices();
        reportList([]);

        const { allResults } = await runOn(1);

        expect(new Set(Object.values(actions(allResults)))).toEqual(
          new Set(['keep']),
        );
      });

      test('an acknowledged list is released on the next run, and a later collapse is held again', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([]);
        await runOn(1);

        expect(importListGuard.acknowledge(7)).toBe('acknowledged');
        const released = await runOn(2);

        expect(new Set(Object.values(actions(released.allResults)))).toEqual(
          new Set(['delete']),
        );
        expect(daysOff(released.enrichedItems)).toEqual([0, 0, 0, 0]);

        reportList([100, 200, 300, 400]);
        await runOn(3);
        reportList([]);
        const collapsedAgain = await runOn(4);

        expect(
          new Set(Object.values(actions(collapsedAgain.allResults))),
        ).toEqual(new Set(['keep']));
      });

      test('a list shrinking past the threshold is held, then accepted after three days at that size', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([100]);

        const held = await runOn(1);
        await runOn(2);
        await runOn(3);
        const accepted = await runOn(4);

        expect(new Set(Object.values(actions(held.allResults)))).toEqual(
          new Set(['keep']),
        );
        expect(actions(accepted.allResults)).toEqual({
          'Listed 100': 'keep',
          'Listed 200': 'delete',
          'Listed 300': 'delete',
          'Listed 400': 'delete',
        });
        expect(daysOff(accepted.enrichedItems)).toEqual([null, 0, 0, 0]);
      });

      test('a shrink within the threshold is not held', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([100, 200, 300]);

        const { allResults } = await runOn(1);

        expect(actions(allResults)['Listed 400']).toBe('delete');
      });

      test('a held list the user then removes from Radarr releases its movies', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([]);
        await runOn(1);
        (
          mockRadarrClient.fetchImportLists as ReturnType<typeof mock>
        ).mockResolvedValue([]);

        const { allResults } = await runOn(2);

        expect(new Set(Object.values(actions(allResults)))).toEqual(
          new Set(['delete']),
        );
      });

      test('a list the user disables in Radarr releases its movies without being reported as collapsed', async () => {
        reportList([100, 200, 300, 400]);
        await runOn(0);
        reportList([]);
        (
          mockRadarrClient.fetchImportLists as ReturnType<typeof mock>
        ).mockResolvedValue([
          { id: 7, name: 'Trakt Watchlist', enabled: false },
        ]);

        const { allResults } = await runOn(1);

        expect(new Set(Object.values(actions(allResults)))).toEqual(
          new Set(['delete']),
        );
        const warnings = warnSpy.mock.calls.map(([message]) => String(message));
        expect(warnings.some(m => m.includes('Trakt Watchlist'))).toBe(false);
      });
    });
  });
});
