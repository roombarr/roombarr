import { describe, expect, test } from 'bun:test';
import type { AuditService } from '../audit/audit.service.js';
import type { RoombarrConfig } from '../config/config.schema.js';
import type { UnifiedMedia } from '../shared/types.js';
import { makeMovie, makeSeason } from '../test/index.js';
import { RulesService } from './rules.service.js';

function makeRules(rules: RoombarrConfig['rules']): RoombarrConfig['rules'] {
  return rules;
}

const mockAuditService = {
  logAction: () => {},
} as unknown as AuditService;

const service = new RulesService(mockAuditService);

describe('RulesService.evaluate', () => {
  test('matches a simple rule', () => {
    const items: UnifiedMedia[] = [
      makeMovie({ radarr: { tags: ['permanent'] } }),
    ];

    const rules = makeRules([
      {
        name: 'Protect permanent',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.tags', operator: 'includes', value: 'permanent' },
          ],
        },
        action: 'keep',
      },
    ]);

    const { results, summary } = service.evaluate(
      items,
      rules,
      'test-eval-id',
      true,
    );
    expect(results[0].resolved_action).toBe('keep');
    expect(results[0].matched_rules).toEqual(['Protect permanent']);
    expect(summary.items_matched).toBe(1);
    expect(summary.actions.keep).toBe(1);
  });

  test('returns null action when no rules match', () => {
    const items: UnifiedMedia[] = [makeMovie()];

    const rules = makeRules([
      {
        name: 'Protect permanent',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'radarr.tags', operator: 'includes', value: 'permanent' },
          ],
        },
        action: 'keep',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBeNull();
    expect(results[0].matched_rules).toEqual([]);
  });

  test('skips rules targeting wrong type', () => {
    const items: UnifiedMedia[] = [makeMovie()];

    const rules = makeRules([
      {
        name: 'Sonarr rule',
        target: 'sonarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'sonarr.season.episode_file_count',
              operator: 'greater_than',
              value: 0,
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBeNull();
  });

  test('least-destructive-wins: keep beats delete', () => {
    const movie = makeMovie({
      radarr: { tags: ['permanent'], added: '2020-01-01T00:00:00Z' },
      jellyfin: {
        watched_by: ['Alice', 'Bob'],
        watched_by_all: true,
        last_played: '2020-06-01T00:00:00Z',
        play_count: 3,
      },
    });
    const items: UnifiedMedia[] = [movie];

    const rules = makeRules([
      {
        name: 'Delete watched',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'jellyfin.watched_by_all',
              operator: 'equals',
              value: true,
            },
          ],
        },
        action: 'delete',
      },
      {
        name: 'Keep permanent',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.tags',
              operator: 'includes',
              value: 'permanent',
            },
          ],
        },
        action: 'keep',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBe('keep');
    expect(results[0].matched_rules).toContain('Delete watched');
    expect(results[0].matched_rules).toContain('Keep permanent');
  });

  test('least-destructive-wins: unmonitor beats delete', () => {
    const items: UnifiedMedia[] = [
      makeMovie({
        radarr: {
          size_on_disk: 60_000_000_000,
          added: '2020-01-01T00:00:00Z',
        },
        jellyfin: {
          watched_by: [],
          watched_by_all: false,
          last_played: null,
          play_count: 0,
        },
      }),
    ];

    const rules = makeRules([
      {
        name: 'Delete untouched',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'jellyfin.watched_by', operator: 'is_empty' },
            { field: 'radarr.added', operator: 'older_than', value: '90d' },
          ],
        },
        action: 'delete',
      },
      {
        name: 'Unmonitor huge',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.size_on_disk',
              operator: 'greater_than',
              value: 50_000_000_000,
            },
          ],
        },
        action: 'unmonitor',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBe('unmonitor');
  });

  test('skips rule when referenced service data is missing', () => {
    const items: UnifiedMedia[] = [makeMovie()];

    const rules = makeRules([
      {
        name: 'Needs jellyfin',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'jellyfin.watched_by_all',
              operator: 'equals',
              value: true,
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results, summary } = service.evaluate(
      items,
      rules,
      'test-eval-id',
      true,
    );
    expect(results[0].resolved_action).toBeNull();
    expect(summary.rules_skipped_missing_data).toBe(1);
  });

  test('evaluates nested AND/OR conditions', () => {
    const movie = makeMovie({
      radarr: { tags: ['seasonal'], added: '2020-01-01T00:00:00Z' },
      jellyfin: {
        watched_by: ['Alice', 'Bob'],
        watched_by_all: true,
        last_played: '2024-06-01T00:00:00Z',
        play_count: 3,
      },
    });
    const items: UnifiedMedia[] = [movie];

    // (watched_by_all OR last_played older_than 180d) AND (tags includes seasonal OR added older_than 90d)
    const rules = makeRules([
      {
        name: 'Nested cleanup',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              operator: 'OR',
              children: [
                {
                  field: 'jellyfin.watched_by_all',
                  operator: 'equals',
                  value: true,
                },
                {
                  field: 'jellyfin.last_played',
                  operator: 'older_than',
                  value: '180d',
                },
              ],
            },
            {
              operator: 'OR',
              children: [
                {
                  field: 'radarr.tags',
                  operator: 'includes',
                  value: 'seasonal',
                },
                {
                  field: 'radarr.added',
                  operator: 'older_than',
                  value: '90d',
                },
              ],
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBe('delete');
  });

  test('evaluates 3+ levels of nesting', () => {
    const movie = makeMovie({
      radarr: { tags: ['seasonal'], genres: ['Action', 'Comedy'] },
    });
    const items: UnifiedMedia[] = [movie];

    const rules = makeRules([
      {
        name: 'Deep nesting',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              operator: 'OR',
              children: [
                {
                  operator: 'AND',
                  children: [
                    {
                      field: 'radarr.tags',
                      operator: 'includes',
                      value: 'seasonal',
                    },
                    {
                      field: 'radarr.status',
                      operator: 'equals',
                      value: 'released',
                    },
                  ],
                },
                {
                  field: 'radarr.genres',
                  operator: 'includes',
                  value: 'Horror',
                },
              ],
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBe('delete');
  });

  test('evaluates sonarr season targets', () => {
    const season = makeSeason({
      sonarr: { season: { episode_file_count: 5 } },
    });
    const items: UnifiedMedia[] = [season];

    const rules = makeRules([
      {
        name: 'Has files',
        target: 'sonarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'sonarr.season.episode_file_count',
              operator: 'greater_than',
              value: 0,
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBe('delete');
    expect(results[0].type).toBe('season');
  });

  test('handles multiple items with mixed types', () => {
    const items: UnifiedMedia[] = [
      makeMovie({ tmdb_id: 1, title: 'Movie 1' }),
      makeSeason({ tvdb_id: 2, title: 'Show 1' }),
      makeMovie({ tmdb_id: 3, title: 'Movie 2' }),
    ];

    const rules = makeRules([
      {
        name: 'Delete all movies',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.size_on_disk',
              operator: 'greater_than',
              value: 0,
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results, summary } = service.evaluate(
      items,
      rules,
      'test-eval-id',
      true,
    );
    expect(summary.items_evaluated).toBe(3);
    expect(summary.items_matched).toBe(2);
    expect(results[0].resolved_action).toBe('delete');
    expect(results[1].resolved_action).toBeNull(); // season, rule targets radarr
    expect(results[2].resolved_action).toBe('delete');
  });

  test('is_empty works for unwatched movies', () => {
    const items: UnifiedMedia[] = [
      makeMovie({
        jellyfin: {
          watched_by: [],
          watched_by_all: false,
          last_played: null,
          play_count: 0,
        },
        radarr: { added: '2020-01-01T00:00:00Z' },
      }),
    ];

    const rules = makeRules([
      {
        name: 'Delete untouched',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            { field: 'jellyfin.watched_by', operator: 'is_empty' },
            { field: 'radarr.added', operator: 'older_than', value: '90d' },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(results[0].resolved_action).toBe('delete');
  });

  test('summary counts are correct', () => {
    const items: UnifiedMedia[] = [
      makeMovie({ tmdb_id: 1, title: 'Movie 1' }),
      makeMovie({
        tmdb_id: 2,
        title: 'Movie 2',
        jellyfin: {
          watched_by: ['Alice', 'Bob'],
          watched_by_all: true,
          last_played: '2024-06-01T00:00:00Z',
          play_count: 3,
        },
      }),
      makeMovie({
        tmdb_id: 3,
        title: 'Movie 3',
        radarr: { tags: ['permanent'] },
        jellyfin: {
          watched_by: ['Alice', 'Bob'],
          watched_by_all: true,
          last_played: '2024-06-01T00:00:00Z',
          play_count: 3,
        },
      }),
    ];

    const rules = makeRules([
      {
        name: 'Delete watched',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'jellyfin.watched_by_all',
              operator: 'equals',
              value: true,
            },
          ],
        },
        action: 'delete',
      },
      {
        name: 'Keep permanent',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.tags',
              operator: 'includes',
              value: 'permanent',
            },
          ],
        },
        action: 'keep',
      },
    ]);

    const { summary } = service.evaluate(items, rules, 'test-eval-id', true);
    expect(summary.items_evaluated).toBe(3);
    // Movie 1: skipped (no jellyfin) for "Delete watched", no match for "Keep permanent" → null
    // Movie 2: matches "Delete watched" → delete
    // Movie 3: matches both → keep wins
    expect(summary.items_matched).toBe(2);
    expect(summary.rules_skipped_missing_data).toBe(1);
  });

  test('all results have dry_run: true', () => {
    const items: UnifiedMedia[] = [makeMovie()];
    const rules = makeRules([
      {
        name: 'Any rule',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.size_on_disk',
              operator: 'greater_than',
              value: 0,
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', true);
    for (const result of results) {
      expect(result.dry_run).toBe(true);
    }
  });

  test('all results have dry_run: false when evaluated with false', () => {
    const items: UnifiedMedia[] = [makeMovie()];
    const rules = makeRules([
      {
        name: 'Any rule',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.size_on_disk',
              operator: 'greater_than',
              value: 0,
            },
          ],
        },
        action: 'delete',
      },
    ]);

    const { results } = service.evaluate(items, rules, 'test-eval-id', false);
    for (const result of results) {
      expect(result.dry_run).toBe(false);
    }
  });
});
