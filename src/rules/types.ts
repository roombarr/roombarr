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
  external_id: number;
  matched_rules: string[];
  resolved_action: Action | null;
  dry_run: boolean;
  /** Present only when dry_run is false and an action was attempted. */
  execution_status?: ExecutionStatus;
  /** Error message if execution_status is 'failed'. */
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
