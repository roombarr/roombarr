import type {
  EvaluationItemResult,
  EvaluationSummary,
} from '../rules/types.js';

export type EvaluationStatus = 'running' | 'completed' | 'failed';

export interface EvaluationRun {
  run_id: string;
  status: EvaluationStatus;
  started_at: string;
  completed_at: string | null;
  summary: EvaluationSummary | null;
  results: EvaluationItemResult[];
  error: string | null;
  services_unavailable: string[];
}
