import { Inject, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import type { Action } from '../config/config.schema.js';
import { INTEGRATION_PROVIDER } from '../integration/integration.constants.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import type { EvaluationItemResult } from '../rules/types.js';
import { buildInternalId, type UnifiedMedia } from '../shared/types.js';
import type { ExecutionSummary } from './execution.types.js';

@Injectable()
export class ActionExecutorService {
  private readonly logger = new Logger(ActionExecutorService.name);
  private readonly providersByTarget: Map<string, IntegrationProvider>;

  constructor(
    @Inject(INTEGRATION_PROVIDER)
    providers: IntegrationProvider[],
  ) {
    this.providersByTarget = new Map(
      providers.filter(p => !!p.executeAction).map(p => [p.name, p]),
    );
  }

  /**
   * Execute resolved actions against service providers.
   * In dry-run mode, every result is marked as 'skipped' with no API calls.
   * In live mode, each actionable item is executed sequentially.
   */
  async execute(
    results: EvaluationItemResult[],
    items: UnifiedMedia[],
    dryRun: boolean,
  ): Promise<{
    results: EvaluationItemResult[];
    executionSummary?: ExecutionSummary;
  }> {
    if (dryRun)
      return {
        results: results.map(r => ({
          ...r,
          execution_status: 'skipped' as const,
        })),
      };

    const itemsByInternalId = new Map(
      items.map(item => [buildInternalId(item), item]),
    );

    const executed: EvaluationItemResult[] = [];
    const counts: Record<Action, number> = { keep: 0, unmonitor: 0, delete: 0 };
    let failedCount = 0;

    for (const result of results) {
      if (!result.resolved_action || result.resolved_action === 'keep') {
        executed.push({ ...result, execution_status: 'skipped' });
        continue;
      }

      const item = itemsByInternalId.get(result.internal_id);
      if (!item) {
        executed.push({
          ...result,
          execution_status: 'failed',
          execution_error: 'Item not found in hydrated data',
        });
        failedCount++;
        continue;
      }

      const target = item.type === 'movie' ? 'radarr' : 'sonarr';
      const provider = this.providersByTarget.get(target);
      if (!provider) {
        executed.push({
          ...result,
          execution_status: 'failed',
          execution_error: `No action provider registered for target "${target}"`,
        });
        failedCount++;
        continue;
      }

      try {
        await provider.executeAction?.(item, result.resolved_action);
        executed.push({ ...result, execution_status: 'success' });
        counts[result.resolved_action]++;
      } catch (error) {
        if (this.isNotFound(error)) {
          this.logger.warn(
            `${result.resolved_action} "${result.title}": 404 — already removed`,
          );
          executed.push({ ...result, execution_status: 'not_found' });
        } else {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Failed to ${result.resolved_action} "${result.title}": ${message}`,
          );
          executed.push({
            ...result,
            execution_status: 'failed',
            execution_error: `Failed to ${result.resolved_action} item`,
          });
          failedCount++;
        }
      }
    }

    return {
      results: executed,
      executionSummary: {
        actions_executed: counts,
        actions_failed: failedCount,
      },
    };
  }

  /** Check if an error is a 404 Not Found response from Axios. */
  private isNotFound(error: unknown): boolean {
    return error instanceof AxiosError && error.response?.status === 404;
  }
}
