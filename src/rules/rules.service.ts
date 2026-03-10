import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { buildReasoning } from '../audit/reasoning';
import type {
  Condition,
  ConditionGroup,
  LeafCondition,
  RoombarrConfig,
} from '../config/config.schema';
import { getServiceFromField } from '../config/field-registry';
import { buildInternalId, type UnifiedMedia } from '../shared/types';
import { resolveField } from './field-resolver';
import { operators } from './operators';
import {
  ACTION_PRIORITY,
  type Action,
  type EvaluationItemResult,
  type EvaluationSummary,
  type RuleConfig,
  type RuleMatch,
} from './types';

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(private readonly auditService: AuditService) {}

  evaluate(
    items: UnifiedMedia[],
    rules: RoombarrConfig['rules'],
    evaluationId: string,
    dryRun: boolean,
  ): { results: EvaluationItemResult[]; summary: EvaluationSummary } {
    const results: EvaluationItemResult[] = [];
    let skippedCount = 0;

    // Pre-compute reasoning strings per rule (memoized — condition tree is identical for all items)
    const reasoningCache = new Map<string, string>();
    for (const rule of rules) {
      reasoningCache.set(rule.name, buildReasoning(rule.conditions));
    }

    for (const item of items) {
      const matches: RuleMatch[] = [];
      const targetType = item.type === 'movie' ? 'radarr' : 'sonarr';

      for (const rule of rules) {
        if (rule.target !== targetType) continue;

        const skipResult = this.checkMissingServiceData(rule, item);
        if (skipResult.skip) {
          skippedCount++;
          continue;
        }

        if (this.evaluateConditionGroup(rule.conditions, item)) {
          matches.push({ rule_name: rule.name, action: rule.action });
        }
      }

      const resolvedAction = this.resolveAction(matches);
      const externalId = item.type === 'movie' ? item.tmdb_id : item.tvdb_id;
      const matchedRuleNames = matches.map(m => m.rule_name);

      // Emit audit event for destructive actions and keep-overrides
      if (resolvedAction !== null) {
        const isKeepOverride = resolvedAction === 'keep' && matches.length > 1;
        const isDestructive =
          resolvedAction === 'delete' || resolvedAction === 'unmonitor';

        if (isDestructive || isKeepOverride) {
          const winningRule = matches.find(m => m.action === resolvedAction);
          if (!winningRule) {
            this.logger.error(
              `No matching rule found for resolved action "${resolvedAction}" on "${item.title}" — skipping audit`,
            );
          } else {
            this.auditService.logAction({
              item,
              action: resolvedAction,
              winningRule: winningRule.rule_name,
              matchedRules: matchedRuleNames,
              reasoning: reasoningCache.get(winningRule.rule_name) ?? '',
              evaluationId,
              dryRun,
            });
          }
        }
      }

      results.push({
        title: item.title,
        type: item.type,
        internal_id: buildInternalId(item),
        external_id: externalId,
        matched_rules: matchedRuleNames,
        resolved_action: resolvedAction,
        dry_run: dryRun,
      });
    }

    const matched = results.filter(r => r.resolved_action !== null);
    const actionCounts: Record<Action, number> = {
      keep: 0,
      unmonitor: 0,
      delete: 0,
    };
    for (const r of matched) {
      if (r.resolved_action) {
        actionCounts[r.resolved_action]++;
      }
    }

    return {
      results,
      summary: {
        items_evaluated: items.length,
        items_matched: matched.length,
        actions: actionCounts,
        rules_skipped_missing_data: skippedCount,
      },
    };
  }

  /**
   * Services whose data is always present on the unified model and
   * should never cause a rule to be skipped. State is computed locally
   * from SQLite, not fetched from an external API.
   */
  private static readonly ALWAYS_PRESENT_SERVICES = new Set(['state']);

  /**
   * Check if a rule references service data that's missing on the item.
   * If so, the entire rule is skipped for safety.
   */
  private checkMissingServiceData(
    rule: RuleConfig,
    item: UnifiedMedia,
  ): { skip: boolean } {
    const services = this.extractServicePrefixes(rule.conditions);

    for (const service of services) {
      if (RulesService.ALWAYS_PRESENT_SERVICES.has(service)) continue;

      const serviceData = (item as unknown as Record<string, unknown>)[service];
      if (serviceData === null || serviceData === undefined) {
        return { skip: true };
      }
    }

    return { skip: false };
  }

  /**
   * Extract unique service prefixes from all conditions in a rule.
   * e.g., conditions referencing "jellyfin.watched_by" and "radarr.added"
   * returns Set(["jellyfin", "radarr"])
   */
  private extractServicePrefixes(condition: Condition): Set<string> {
    const prefixes = new Set<string>();

    if ('field' in condition) {
      prefixes.add(getServiceFromField((condition as LeafCondition).field));
    } else if ('children' in condition) {
      for (const child of (condition as ConditionGroup).children) {
        for (const prefix of this.extractServicePrefixes(child)) {
          prefixes.add(prefix);
        }
      }
    }

    return prefixes;
  }

  private evaluateConditionGroup(
    group: ConditionGroup,
    item: UnifiedMedia,
  ): boolean {
    if (group.operator === 'AND') {
      return group.children.every(child => this.evaluateCondition(child, item));
    }
    return group.children.some(child => this.evaluateCondition(child, item));
  }

  private evaluateCondition(condition: Condition, item: UnifiedMedia): boolean {
    if ('field' in condition) {
      return this.evaluateLeaf(condition as LeafCondition, item);
    }
    return this.evaluateConditionGroup(condition as ConditionGroup, item);
  }

  private evaluateLeaf(condition: LeafCondition, item: UnifiedMedia): boolean {
    const { value, resolved } = resolveField(item, condition.field);
    if (!resolved) return false;

    const operatorFn = operators[condition.operator];
    if (!operatorFn) {
      this.logger.warn(`Unknown operator: ${condition.operator}`);
      return false;
    }

    return operatorFn(value, condition.value);
  }

  /**
   * Resolve conflicting actions using least-destructive-wins.
   * Priority: keep > unmonitor > delete
   */
  private resolveAction(matches: RuleMatch[]): Action | null {
    if (matches.length === 0) return null;

    let leastDestructive = matches[0];
    for (let i = 1; i < matches.length; i++) {
      if (
        ACTION_PRIORITY[matches[i].action] <
        ACTION_PRIORITY[leastDestructive.action]
      ) {
        leastDestructive = matches[i];
      }
    }

    return leastDestructive.action;
  }
}
