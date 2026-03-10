import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RuleConfig } from '../config/config.schema';
import { getHydratedServices } from '../config/field-registry';
import { ActionExecutorService } from '../execution/action-executor.service';
import { MediaService } from '../media/media.service';
import { RadarrClient } from '../radarr/radarr.client';
import { RadarrService } from '../radarr/radarr.service';
import { RulesService } from '../rules/rules.service';
import type { EvaluationItemResult } from '../rules/types';
import { SnapshotService } from '../snapshot/snapshot.service';
import { StateService } from '../snapshot/state.service';
import {
  createMockRadarrClient,
  createMockSonarrClient,
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

  beforeEach(() => {
    mockRadarrClient = createMockRadarrClient();
    mockAuditService = createMockAuditService();

    const radarrService = new RadarrService(mockRadarrClient);
    mediaService = new MediaService(null, radarrService, null, null);
    snapshotService = new SnapshotService(db.dbService);
    stateService = new StateService(db.dbService);
    rulesService = new RulesService(mockAuditService as any);
    actionExecutor = new ActionExecutorService(
      mockRadarrClient,
      createMockSonarrClient(),
    );
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
  }> {
    const evaluationId = 'e2e-test-run';

    // Step 1: Hydrate
    const { items, unavailableServices } = await mediaService.hydrate(rules);

    // Step 2: Snapshot
    const hydratedServices = getHydratedServices(rules);
    await snapshotService.snapshot(
      items,
      hydratedServices,
      unavailableServices,
    );

    // Step 3: Enrich
    const enrichedItems = stateService.enrich(items);

    // Step 4: Evaluate
    const { results, summary } = rulesService.evaluate(
      enrichedItems,
      rules,
      evaluationId,
      dryRun,
    );

    // Step 5: Execute
    const { results: executedResults, executionSummary } =
      await actionExecutor.execute(results, enrichedItems, dryRun);

    if (executionSummary) {
      summary.actions_executed = executionSummary.actions_executed;
      summary.actions_failed = executionSummary.actions_failed;
    }

    // Step 6: Filter (same as EvaluationService)
    const filteredResults = executedResults.filter(
      r => r.resolved_action !== null,
    );

    return { allResults: executedResults, filteredResults, summary };
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
});
