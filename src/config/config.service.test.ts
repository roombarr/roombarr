import { describe, expect, test } from 'bun:test';
import { configSchema } from './config.schema.js';

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
