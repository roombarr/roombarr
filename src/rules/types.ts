import type {
  Action,
  ConditionGroup,
  RuleConfig,
} from '../config/config.schema.js';
export type { Action, ConditionGroup, RuleConfig };

export type ExecutionStatus = 'success' | 'failed' | 'skipped';

export interface EvaluationItemResult {
  title: string;
  type: 'movie' | 'season';
  /** Composite key unique per item (e.g. "movie:42", "season:10:1"). */
  internal_id: string;
  external_id: number;
  matched_rules: string[];
  resolved_action: Action | null;
  dry_run: boolean;
  /**
   * Present in both dry-run and live mode. Set to 'skipped' for dry-run items
   * and non-actionable items in live mode. Set to 'success' or 'failed' after
   * a live execution attempt. See {@link ExecutionStatus} for possible values.
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
  /** Present only when dry_run is false. */
  actions_executed?: Record<Action, number>;
  actions_failed?: number;
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
