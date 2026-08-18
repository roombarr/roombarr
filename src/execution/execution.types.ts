import type { Action } from '../config/config.schema';

/** Why a run stopped short of executing every resolved action. */
export type AbortReason =
  /** More deletes were resolved than `safety.max_deletes_per_run` allows. */
  | 'max_deletes_per_run_exceeded'
  /** The evaluation exceeded `safety.evaluation_timeout` partway through. */
  | 'evaluation_abandoned';

export interface ExecutionSummary {
  actions_executed: Record<Action, number>;
  actions_failed: number;
  /**
   * Set when a safety limit stopped the run short. Absent on normal runs.
   * `max_deletes_per_run_exceeded` stops before anything is executed;
   * `evaluation_abandoned` can stop partway, so `actions_executed` may be
   * non-zero alongside it.
   */
  aborted_reason?: AbortReason;
}
