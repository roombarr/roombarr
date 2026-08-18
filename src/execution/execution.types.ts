import type { Action } from '../config/config.schema';

export interface ExecutionSummary {
  actions_executed: Record<Action, number>;
  actions_failed: number;
  /**
   * Set when a safety limit stopped the run before any action was executed.
   * Absent on normal runs.
   */
  aborted_reason?: 'max_deletes_per_run_exceeded';
}
