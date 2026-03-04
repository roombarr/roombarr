import type { Action } from '../config/config.schema.js';
import type { UnifiedMedia } from '../shared/types.js';

export interface LogActionParams {
  readonly item: UnifiedMedia;
  readonly action: Action;
  readonly winningRule: string;
  readonly matchedRules: readonly string[];
  readonly reasoning: string;
  readonly evaluationId: string;
  readonly dryRun: boolean;
}

interface BaseAuditEntry {
  timestamp: string;
  evaluation_id: string;
  action: Action;
  rule: string;
  matched_rules: readonly string[];
  reasoning: string;
  dry_run: boolean;
}

export interface MovieAuditEntry extends BaseAuditEntry {
  media_type: 'movie';
  media: {
    title: string;
    year: number;
    tmdb_id: number;
  };
}

export interface SeasonAuditEntry extends BaseAuditEntry {
  media_type: 'season';
  media: {
    title: string;
    year: number;
    tvdb_id: number;
  };
}

export type AuditEntry = MovieAuditEntry | SeasonAuditEntry;
