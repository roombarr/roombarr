import { describe, expect, test } from 'bun:test';
import { makeConfig, makeRule } from '../test/index';
import { configSchema, validateConfig } from './config.schema';

function validConfig(overrides: Record<string, any> = {}) {
  return {
    services: {
      sonarr: {
        base_url: 'http://localhost:8989',
        api_key: 'test-key',
      },
      radarr: {
        base_url: 'http://localhost:7878',
        api_key: 'test-key',
      },
      jellyfin: {
        base_url: 'http://localhost:8096',
        api_key: 'test-key',
      },
      jellyseerr: {
        base_url: 'http://localhost:5055',
        api_key: 'test-key',
      },
    },
    schedule: '0 3 * * *',
    rules: [
      {
        name: 'Test rule',
        target: 'radarr',
        conditions: {
          operator: 'AND',
          children: [
            {
              field: 'radarr.added',
              operator: 'older_than',
              value: '30d',
            },
          ],
        },
        action: 'delete',
      },
    ],
    ...overrides,
  };
}

describe('configSchema', () => {
  test('parses a valid full config', () => {
    const result = configSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
  });

  test('applies default for performance.concurrency', () => {
    const result = configSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.performance.concurrency).toBe(10);
    }
  });

  test('allows custom performance.concurrency', () => {
    const result = configSchema.safeParse(
      validConfig({ performance: { concurrency: 5 } }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.performance.concurrency).toBe(5);
    }
  });

  test('applies defaults for audit section when omitted', () => {
    const result = configSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audit.retention_days).toBe(90);
    }
  });

  test('allows custom audit settings', () => {
    const result = configSchema.safeParse(
      validConfig({
        audit: { retention_days: 30 },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audit.retention_days).toBe(30);
    }
  });

  test('rejects audit.retention_days less than 1', () => {
    const result = configSchema.safeParse(
      validConfig({ audit: { retention_days: 0 } }),
    );
    expect(result.success).toBe(false);
  });

  test('rejects missing schedule', () => {
    const { schedule, ...rest } = validConfig();
    const result = configSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test('rejects invalid cron expression', () => {
    const result = configSchema.safeParse(validConfig({ schedule: 'banana' }));
    expect(result.success).toBe(false);
  });

  test('rejects cron with wrong field count', () => {
    const result = configSchema.safeParse(validConfig({ schedule: '0 3 * *' }));
    expect(result.success).toBe(false);
  });

  test('rejects cron with out-of-range values', () => {
    const result = configSchema.safeParse(
      validConfig({ schedule: '99 * * * *' }),
    );
    expect(result.success).toBe(false);
  });

  test('accepts valid cron expression', () => {
    const result = configSchema.safeParse(
      validConfig({ schedule: '*/5 * * * *' }),
    );
    expect(result.success).toBe(true);
  });

  test('rejects empty rules array', () => {
    const result = configSchema.safeParse(validConfig({ rules: [] }));
    expect(result.success).toBe(false);
  });

  test('rejects rule with empty name', () => {
    const config = validConfig({
      rules: [
        {
          name: '',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.added', operator: 'older_than', value: '30d' },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects invalid target', () => {
    const config = validConfig({
      rules: [
        {
          name: 'Bad target',
          target: 'plex',
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.added', operator: 'older_than', value: '30d' },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects invalid action', () => {
    const config = validConfig({
      rules: [
        {
          name: 'Bad action',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.added', operator: 'older_than', value: '30d' },
            ],
          },
          action: 'blocklist',
        },
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects invalid service URL', () => {
    const config = validConfig({
      services: {
        radarr: { base_url: 'not-a-url', api_key: 'key' },
      },
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects empty API key', () => {
    const config = validConfig({
      services: {
        radarr: { base_url: 'http://localhost:7878', api_key: '' },
      },
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('accepts nested AND/OR conditions', () => {
    const config = validConfig({
      rules: [
        {
          name: 'Nested rule',
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
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test('rejects empty children array', () => {
    const config = validConfig({
      rules: [
        {
          name: 'Empty children',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [],
          },
          action: 'delete',
        },
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects invalid field path format', () => {
    const config = validConfig({
      rules: [
        {
          name: 'Bad field',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'UPPER.case',
                operator: 'equals',
                value: true,
              },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('accepts optional services as missing', () => {
    const config = validConfig({
      services: {
        radarr: { base_url: 'http://localhost:7878', api_key: 'key' },
      },
      rules: [
        {
          name: 'Radarr only',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.added', operator: 'older_than', value: '30d' },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const result = configSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test('rejects concurrency above 50', () => {
    const result = configSchema.safeParse(
      validConfig({ performance: { concurrency: 100 } }),
    );
    expect(result.success).toBe(false);
  });

  test('rejects concurrency below 1', () => {
    const result = configSchema.safeParse(
      validConfig({ performance: { concurrency: 0 } }),
    );
    expect(result.success).toBe(false);
  });
});

describe('validateConfig (cross-validation)', () => {
  test('passes with valid full config', () => {
    const errors = validateConfig(makeConfig());
    expect(errors).toEqual([]);
  });

  test('fails when no arr service is configured', () => {
    const config = makeConfig();
    config.services.sonarr = undefined;
    config.services.radarr = undefined;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'At least one of services.sonarr or services.radarr',
      ),
    );
  });

  test('fails when sonarr rule targets unconfigured sonarr', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          target: 'sonarr',
          conditions: {
            operator: 'AND',
            children: [
              { field: 'sonarr.tags', operator: 'includes', value: 'test' },
            ],
          },
          action: 'keep',
        }),
      ],
    });
    config.services.sonarr = undefined;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'targets sonarr but services.sonarr is not configured',
      ),
    );
  });

  test('fails when radarr rule targets unconfigured radarr', () => {
    const config = makeConfig();
    config.services.radarr = undefined;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'targets radarr but services.radarr is not configured',
      ),
    );
  });

  test('fails when jellyfin field used without jellyfin configured', () => {
    const config = makeConfig({
      rules: [
        makeRule({
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
        }),
      ],
    });
    config.services.jellyfin = undefined;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('requires services.jellyfin to be configured'),
    );
  });

  test('fails when jellyseerr field used without jellyseerr configured', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'jellyseerr.requested_at',
                operator: 'older_than',
                value: '90d',
              },
            ],
          },
        }),
      ],
    });
    config.services.jellyseerr = undefined;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('requires services.jellyseerr to be configured'),
    );
  });

  test('fails for unknown field path', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.nonexistent',
                operator: 'equals',
                value: true,
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('unknown field "radarr.nonexistent"'),
    );
  });

  test('fails for incompatible operator and field type', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.tags', operator: 'older_than', value: '30d' },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'operator "older_than" is not compatible with field "radarr.tags"',
      ),
    );
  });

  test('fails when is_empty has a value', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.tags',
                operator: 'is_empty',
                value: 'should-not-be-here',
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('operator "is_empty" must not have a value'),
    );
  });

  test('fails when equals has no value', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [{ field: 'radarr.monitored', operator: 'equals' }],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('operator "equals" requires a value'),
    );
  });

  test('fails when temporal operator value is not a string', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.added', operator: 'older_than', value: 30 },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('requires a duration string, got number'),
    );
  });

  test('fails for invalid duration string', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.added',
                operator: 'older_than',
                value: 'notaduration',
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('invalid duration "notaduration"'),
    );
  });

  test('validates nested condition fields recursively', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                operator: 'OR',
                children: [
                  {
                    field: 'radarr.fake_field',
                    operator: 'equals',
                    value: true,
                  },
                ],
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(
      expect.stringContaining('unknown field "radarr.fake_field"'),
    );
  });

  test('passes with is_empty and no value', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [{ field: 'radarr.tags', operator: 'is_empty' }],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  test('passes with state fields on radarr target', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'state.days_off_import_list',
                operator: 'greater_than',
                value: 30,
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  test('fails when state fields are used on sonarr target (state fields are Radarr-only)', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          target: 'sonarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'state.days_off_import_list',
                operator: 'greater_than',
                value: 30,
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('state.days_off_import_list');
  });

  test('passes with new radarr import list fields', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          action: 'keep',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.on_import_list',
                operator: 'equals',
                value: true,
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  test('state fields do not require service config', () => {
    const config = makeConfig({
      services: {
        radarr: { base_url: 'http://localhost:7878', api_key: 'key' },
      },
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'state.ever_on_import_list',
                operator: 'equals',
                value: true,
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  test('passes with radarr.has_file field', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          conditions: {
            operator: 'AND',
            children: [
              { field: 'radarr.has_file', operator: 'equals', value: true },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  test('passes with sonarr.season.has_file field', () => {
    const config = makeConfig({
      rules: [
        makeRule({
          target: 'sonarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'sonarr.season.has_file',
                operator: 'equals',
                value: true,
              },
            ],
          },
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  test('passes with sonarr season fields', () => {
    const config = makeConfig({
      rules: [
        makeRule({
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
        }),
      ],
    });
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });
});
