import type {
  Action,
  ConditionGroup,
  RuleConfig,
} from '../config/config.schema';
import type { AbortReason } from '../execution/execution.types';
export type { Action, ConditionGroup, RuleConfig };

export type ExecutionStatus = 'success' | 'failed' | 'skipped' | 'not_found';

/** A built-in safety guard that can skip a resolved action. */
export type SafetyGuard = 'protect_airing_seasons';

/** Why a safety guard stopped a resolved action from being executed. */
export interface GuardSkip {
  guard: SafetyGuard;
  /** Human-readable explanation, prefixed with the guard name. */
  reason: string;
}

/**
 * How an item resolved. Only a delete can be skipped by a guard; the item
 * still reports `delete` so it can't be mistaken for a rule that didn't match.
 */
type Resolution =
  | { resolved_action: Action | null; skipped_by_guard?: undefined }
  | { resolved_action: 'delete'; skipped_by_guard: GuardSkip };

export type EvaluationItemResult = EvaluationItemFields & Resolution;

interface EvaluationItemFields {
  title: string;
  type: 'movie' | 'season';
  /** Composite key unique per item (e.g. "movie:42", "season:10:1"). */
  internal_id: string;
  external_id: number;
  matched_rules: string[];
  dry_run: boolean;
  /**
   * Present in both dry-run and live mode. Set to 'skipped' for dry-run items
   * and non-actionable items in live mode. Set to 'success' or 'failed' after
   * a live execution attempt. A 404 response is treated as a desired end state
   * and mapped to 'not_found'. See {@link ExecutionStatus} for possible values.
   */
  execution_status?: ExecutionStatus;
  /** Error message populated only when execution_status is 'failed'. */
  execution_error?: string;
}

export interface EvaluationSummary {
  items_evaluated: number;
  items_matched: number;
  actions: Record<Action, number>;
  rules_skipped_missing_data: number;
  /**
   * Resolved deletes a safety guard skipped. These are still counted in
   * `actions.delete` but are never executed.
   */
  deletes_skipped_by_guard: number;
  /** Present only when dry_run is false. */
  actions_executed?: Record<Action, number>;
  actions_failed?: number;
  /**
   * Present only when a safety limit stopped execution short. Its absence on a
   * completed run means every resolved action was attempted.
   */
  aborted_reason?: AbortReason;
}

export interface RuleMatch {
  rule_name: string;
  action: Action;
}

export const ACTION_PRIORITY: Record<Action, number> = {
  keep: 0,
  unmonitor: 1,
  delete: 2,
};
