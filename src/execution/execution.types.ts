import type { Action } from '../config/config.schema';

export interface ExecutionSummary {
  actions_executed: Record<Action, number>;
  actions_failed: number;
}
