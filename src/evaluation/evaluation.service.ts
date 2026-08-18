import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import parseDuration from 'parse-duration';
import { ConfigService } from '../config/config.service';
import { matchesCron } from '../config/cron';
import { getHydratedServices } from '../config/field-registry';
import { ActionExecutorService } from '../execution/action-executor.service';
import { MediaService } from '../media/media.service';
import { RulesService } from '../rules/rules.service';
import { SnapshotService } from '../snapshot/snapshot.service';
import { StateService } from '../snapshot/state.service';
import type { EvaluationRun } from './evaluation.types';

const MAX_STORED_RUNS = 10;

/** Raised when an evaluation exceeds its configured wall-clock budget. */
class EvaluationTimeoutError extends Error {
  constructor(timeout: string) {
    super(`Evaluation exceeded its ${timeout} budget and was abandoned`);
    this.name = 'EvaluationTimeoutError';
  }
}

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
    const { evaluation_timeout } = this.configService.getConfig().safety;

    try {
      await this.withDeadline(
        this.runPipeline(run),
        evaluation_timeout,
        run.run_id,
      );
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
   * Race a pipeline against its wall-clock budget.
   *
   * On timeout the pipeline promise is abandoned rather than cancelled — it may
   * never settle, which is precisely the failure being defended against. What
   * matters is that this method returns, so the caller's `finally` can release
   * the scheduler.
   */
  private async withDeadline(
    pipeline: Promise<void>,
    timeout: string,
    runId: string,
  ): Promise<void> {
    const ms = parseDuration(timeout);
    if (ms === null || ms <= 0) {
      throw new Error(`Invalid safety.evaluation_timeout: "${timeout}"`);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        pipeline,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.logger.error(
              `Evaluation ${runId} exceeded its ${timeout} budget — abandoning the run and releasing the scheduler. The next scheduled evaluation will proceed normally.`,
            );
            reject(new EvaluationTimeoutError(timeout));
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Whether this run has been abandoned by its deadline.
   *
   * A timed-out run is already marked failed and the scheduler has been
   * released, so a later evaluation may be underway. The abandoned pipeline can
   * still settle at any await point; when it does it must not write state,
   * execute actions, or report itself completed. Checked at each step boundary,
   * which is the closest a non-cancellable pipeline can get to stopping.
   */
  private isAbandoned(run: EvaluationRun): boolean {
    if (run.status === 'running') return false;

    this.logger.warn(
      `Evaluation ${run.run_id} continued after being abandoned — discarding its results`,
    );
    return true;
  }

  private async runPipeline(run: EvaluationRun): Promise<void> {
    const config = this.configService.getConfig();
    const { rules } = config;

    this.logger.log(
      `Evaluation ${run.run_id} started: ${rules.length} rules to evaluate`,
    );

    // Step 1: Hydrate unified models from all services
    const items = await this.mediaService.hydrate(rules);
    if (this.isAbandoned(run)) return;

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

    if (this.isAbandoned(run)) return;

    // Step 5: Execute actions (no-op in dry-run mode)
    const { results: executedResults, executionSummary } =
      await this.actionExecutor.execute(results, enrichedItems, run.dry_run);

    if (executionSummary) {
      summary.actions_executed = executionSummary.actions_executed;
      summary.actions_failed = executionSummary.actions_failed;
    }

    if (this.isAbandoned(run)) return;

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
