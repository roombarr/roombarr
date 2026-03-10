import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '../config/config.service';
import { getHydratedServices } from '../config/field-registry';
import { ActionExecutorService } from '../execution/action-executor.service';
import { MediaService } from '../media/media.service';
import { RulesService } from '../rules/rules.service';
import { SnapshotService } from '../snapshot/snapshot.service';
import { StateService } from '../snapshot/state.service';
import type { EvaluationRun } from './evaluation.types';
import { matchesCron } from '../config/cron';

const MAX_STORED_RUNS = 10;

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);
  private readonly runs: EvaluationRun[] = [];
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly mediaService: MediaService,
    private readonly rulesService: RulesService,
    private readonly snapshotService: SnapshotService,
    private readonly stateService: StateService,
    private readonly actionExecutor: ActionExecutorService,
  ) {}

  /**
   * Whether an evaluation is currently in progress.
   * Used by the controller to reject concurrent requests.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Retrieve a stored evaluation run by ID.
   * Returns undefined if the run has been evicted or never existed.
   */
  getRun(runId: string): EvaluationRun | undefined {
    return this.runs.find(r => r.run_id === runId);
  }

  /**
   * Trigger a scheduled evaluation via cron.
   * The cron expression comes from config, but NestJS @Cron requires
   * a static decorator — so we use a frequent tick and check manually.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    if (!this.shouldRunCron()) return;

    if (this.running) {
      this.logger.warn(
        'Skipping scheduled evaluation: another evaluation is already running',
      );
      return;
    }

    this.logger.log('Cron-triggered evaluation starting');
    await this.runEvaluation();
  }

  /**
   * Start an evaluation run. Returns the run immediately (status: running).
   * The evaluation continues asynchronously.
   */
  startEvaluation(): EvaluationRun {
    const config = this.configService.getConfig();
    const run: EvaluationRun = {
      run_id: randomUUID(),
      status: 'running',
      dry_run: config.dry_run,
      started_at: new Date().toISOString(),
      completed_at: null,
      summary: null,
      results: [],
      error: null,
      services_unavailable: [],
    };

    this.storeRun(run);
    this.running = true;

    // Fire and forget — the run updates in place
    this.executeEvaluation(run).catch(error => {
      this.logger.error(
        `Evaluation ${run.run_id} failed unexpectedly: ${error}`,
      );
    });

    return run;
  }

  /**
   * Run a full evaluation synchronously (used by cron).
   * Returns when complete.
   */
  async runEvaluation(): Promise<EvaluationRun> {
    const config = this.configService.getConfig();
    const run: EvaluationRun = {
      run_id: randomUUID(),
      status: 'running',
      dry_run: config.dry_run,
      started_at: new Date().toISOString(),
      completed_at: null,
      summary: null,
      results: [],
      error: null,
      services_unavailable: [],
    };

    this.storeRun(run);
    this.running = true;

    await this.executeEvaluation(run);
    return run;
  }

  private async executeEvaluation(run: EvaluationRun): Promise<void> {
    try {
      const config = this.configService.getConfig();
      const { rules } = config;

      this.logger.log(
        `Evaluation ${run.run_id} started: ${rules.length} rules to evaluate`,
      );

      // Step 1: Hydrate unified models from all services
      const items = await this.mediaService.hydrate(rules);

      // Step 2: Snapshot — persist unified models, detect field changes
      const hydratedServices = getHydratedServices(rules);
      await this.snapshotService.snapshot(items, hydratedServices);

      // Step 3: Enrich — compute temporal state fields from change history
      const enrichedItems = this.stateService.enrich(items);

      // Step 4: Evaluate rules against all items
      const { results, summary } = this.rulesService.evaluate(
        enrichedItems,
        rules,
        run.run_id,
        run.dry_run,
      );

      // Step 5: Execute actions (no-op in dry-run mode)
      const { results: executedResults, executionSummary } =
        await this.actionExecutor.execute(results, enrichedItems, run.dry_run);

      if (executionSummary) {
        summary.actions_executed = executionSummary.actions_executed;
        summary.actions_failed = executionSummary.actions_failed;
      }

      // Step 6: Update run with results
      run.status = 'completed';
      run.completed_at = new Date().toISOString();
      run.summary = summary;
      run.results = executedResults.filter(r => r.resolved_action !== null);

      this.logger.log({
        msg: `Evaluation ${run.run_id} completed`,
        run_id: run.run_id,
        dry_run: run.dry_run,
        items_evaluated: summary.items_evaluated,
        items_matched: summary.items_matched,
        actions: summary.actions,
        rules_skipped_missing_data: summary.rules_skipped_missing_data,
        actions_executed: summary.actions_executed ?? null,
        actions_failed: summary.actions_failed ?? null,
      });
    } catch (error) {
      run.status = 'failed';
      run.completed_at = new Date().toISOString();
      run.error =
        error instanceof Error ? error.message : 'Unknown error occurred';

      this.logger.error(`Evaluation ${run.run_id} failed: ${run.error}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Check if the current minute matches the configured cron schedule.
   * Since NestJS @Cron doesn't support dynamic expressions from config,
   * we tick every minute and compare against the config schedule.
   */
  private shouldRunCron(): boolean {
    const schedule = this.configService.getConfig().schedule;
    return matchesCron(schedule, new Date());
  }

  private storeRun(run: EvaluationRun): void {
    this.runs.push(run);
    if (this.runs.length > MAX_STORED_RUNS) {
      this.runs.shift();
    }
  }
}
