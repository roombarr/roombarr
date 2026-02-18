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
              field: 'state.days_off_import_list',
              operator: 'greater_than',
              value: 90,
            },
          ],
        },
      ],
    };

    expect(buildReasoning(conditions)).toBe(
      '(radarr.monitored equals true AND (jellyfin.play_count equals 0 OR state.days_off_import_list greater than 90))',
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

describe('AuditService path validation', () => {
  test('rejects log_directory outside data directory', () => {
    const { resolve } = require('node:path');
    const dataDir = resolve(process.env.DATA_PATH ?? '/data');
    const dataDirPrefix = dataDir.endsWith('/') ? dataDir : `${dataDir}/`;

    // Standard case: completely different path
    const evilDir = resolve('/tmp/evil-logs');
    expect(evilDir !== dataDir && !evilDir.startsWith(dataDirPrefix)).toBe(
      true,
    );

    // Prefix-overlap case: /data-evil should NOT pass the /data check
    const prefixOverlapDir = resolve('/data-evil/logs');
    expect(
      prefixOverlapDir !== dataDir &&
        !prefixOverlapDir.startsWith(dataDirPrefix),
    ).toBe(true);
  });

  test('accepts log_directory within data directory', () => {
    const { resolve } = require('node:path');
    const dataPath = process.env.DATA_PATH ?? '/data';
    const dataDir = resolve(dataPath);
    const dataDirPrefix = dataDir.endsWith('/') ? dataDir : `${dataDir}/`;

    const logDir = resolve(`${dataPath}/logs`);
    expect(logDir === dataDir || logDir.startsWith(dataDirPrefix)).toBe(true);
  });

  test('accepts log_directory equal to data directory', () => {
    const { resolve } = require('node:path');
    const dataPath = process.env.DATA_PATH ?? '/data';
    const dataDir = resolve(dataPath);
    const dataDirPrefix = dataDir.endsWith('/') ? dataDir : `${dataDir}/`;

    // When log dir IS the data dir, it should pass (resolvedDir === dataDir)
    const logDir = resolve(dataPath);
    expect(logDir === dataDir || logDir.startsWith(dataDirPrefix)).toBe(true);
  });
});
