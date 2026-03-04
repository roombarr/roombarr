import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Condition, RoombarrConfig } from '../config/config.schema.js';
import { ConfigService } from '../config/config.service.js';
import { getServiceFromField } from '../config/field-registry.js';
import { ActionExecutorService } from '../execution/action-executor.service.js';
import { MediaService } from '../media/media.service.js';
import { RulesService } from '../rules/rules.service.js';
import { SnapshotService } from '../snapshot/snapshot.service.js';
import { StateService } from '../snapshot/state.service.js';
import type { EvaluationRun } from './evaluation.types.js';

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
      const hydratedServices = this.getHydratedServices(rules);
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
        items_evaluated: summary.items_evaluated,
        items_matched: summary.items_matched,
        actions: summary.actions,
        rules_skipped_missing_data: summary.rules_skipped_missing_data,
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
    return this.matchesCron(schedule, new Date());
  }

  /**
   * Simple cron expression matcher for standard 5-field cron.
   * Supports: numbers, '*', step values (star/N), ranges, and lists.
   */
  private matchesCron(expression: string, date: Date): boolean {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const fields = [
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth() + 1,
      date.getDay(),
    ];

    return parts.every((part, i) => this.matchesCronField(part, fields[i]));
  }

  private matchesCronField(field: string, value: number): boolean {
    // Handle lists (e.g., "1,15,30")
    if (field.includes(',')) {
      return field.split(',').some(f => this.matchesCronField(f, value));
    }

    // Handle step values (e.g., "*/5")
    if (field.includes('/')) {
      const [range, stepStr] = field.split('/');
      const step = Number.parseInt(stepStr, 10);
      if (range === '*') return value % step === 0;
      return false;
    }

    // Handle ranges (e.g., "1-5")
    if (field.includes('-')) {
      const [minStr, maxStr] = field.split('-');
      const min = Number.parseInt(minStr, 10);
      const max = Number.parseInt(maxStr, 10);
      return value >= min && value <= max;
    }

    // Wildcard
    if (field === '*') return true;

    // Exact match
    return Number.parseInt(field, 10) === value;
  }

  /**
   * Determine which service prefixes were hydrated for the given rules.
   * The base service (radarr/sonarr) is always hydrated for its rule target.
   * Enrichment services are hydrated if referenced in any condition.
   */
  private getHydratedServices(rules: RoombarrConfig['rules']): Set<string> {
    const services = new Set<string>();

    for (const rule of rules) {
      // The base service for the rule target is always hydrated
      services.add(rule.target);
      this.collectFieldServices(rule.conditions, services);
    }

    return services;
  }

  private collectFieldServices(
    condition: Condition,
    services: Set<string>,
  ): void {
    if ('field' in condition) {
      services.add(getServiceFromField(condition.field));
    } else if ('children' in condition) {
      for (const child of condition.children) {
        this.collectFieldServices(child, services);
      }
    }
  }

  private storeRun(run: EvaluationRun): void {
    this.runs.push(run);
    if (this.runs.length > MAX_STORED_RUNS) {
      this.runs.shift();
    }
  }
}
