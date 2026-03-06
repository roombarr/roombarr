import { describe, expect, test } from 'bun:test';
import type { ConditionGroup } from '../config/config.schema.js';
import { buildReasoning } from './reasoning.js';

describe('buildReasoning', () => {
  test('formats a single leaf condition', () => {
    const conditions: ConditionGroup = {
      operator: 'AND',
      children: [
        { field: 'radarr.monitored', operator: 'equals', value: true },
      ],
    };

    expect(buildReasoning(conditions)).toBe('radarr.monitored equals true');
  });

  test('formats AND group with multiple conditions', () => {
    const conditions: ConditionGroup = {
      operator: 'AND',
      children: [
        { field: 'radarr.monitored', operator: 'equals', value: true },
        { field: 'jellyfin.play_count', operator: 'equals', value: 0 },
      ],
    };

    expect(buildReasoning(conditions)).toBe(
      '(radarr.monitored equals true AND jellyfin.play_count equals 0)',
    );
  });

  test('formats OR group', () => {
    const conditions: ConditionGroup = {
      operator: 'OR',
      children: [
        { field: 'radarr.added', operator: 'older_than', value: '180d' },
        {
          field: 'jellyfin.watched_by_all',
          operator: 'equals',
          value: true,
        },
      ],
    };

    expect(buildReasoning(conditions)).toBe(
      '(radarr.added older than "180d" OR jellyfin.watched_by_all equals true)',
    );
  });

  test('formats nested condition groups', () => {
    const conditions: ConditionGroup = {
      operator: 'AND',
      children: [
        { field: 'radarr.monitored', operator: 'equals', value: true },
        {
          operator: 'OR',
          children: [
            { field: 'jellyfin.play_count', operator: 'equals', value: 0 },
            {
              field: 'state.import_list_removed_at',
              operator: 'older_than',
              value: '90d',
            },
          ],
        },
      ],
    };

    expect(buildReasoning(conditions)).toBe(
      '(radarr.monitored equals true AND (jellyfin.play_count equals 0 OR state.import_list_removed_at older than "90d"))',
    );
  });

  test('formats is_empty operator without value', () => {
    const conditions: ConditionGroup = {
      operator: 'AND',
      children: [{ field: 'jellyfin.watched_by', operator: 'is_empty' }],
    };

    expect(buildReasoning(conditions)).toBe('jellyfin.watched_by is empty');
  });

  test('formats is_not_empty operator without value', () => {
    const conditions: ConditionGroup = {
      operator: 'AND',
      children: [{ field: 'jellyfin.watched_by', operator: 'is_not_empty' }],
    };

    expect(buildReasoning(conditions)).toBe('jellyfin.watched_by is not empty');
  });

  test('formats includes operator with string value', () => {
    const conditions: ConditionGroup = {
      operator: 'AND',
      children: [
        { field: 'radarr.tags', operator: 'includes', value: 'permanent' },
      ],
    };

    expect(buildReasoning(conditions)).toBe('radarr.tags includes "permanent"');
  });

  test('formats 3+ levels of nesting', () => {
    const conditions: ConditionGroup = {
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
    };

    expect(buildReasoning(conditions)).toBe(
      '((radarr.tags includes "seasonal" AND radarr.status equals "released") OR radarr.genres includes "Horror")',
    );
  });
});
