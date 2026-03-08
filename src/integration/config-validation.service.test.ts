import { describe, expect, test } from 'bun:test';
import { configSchema, type RoombarrConfig } from '../config/config.schema.js';
import { jellyfinFields } from '../jellyfin/jellyfin.fields.js';
import { jellyseerrFields } from '../jellyseerr/jellyseerr.fields.js';
import { radarrFields } from '../radarr/radarr.fields.js';
import type { StateFieldPattern } from '../snapshot/state-registry.js';
import { sonarrFields } from '../sonarr/sonarr.fields.js';
import { ConfigValidationService } from './config-validation.service.js';
import { FieldRegistryService } from './field-registry.service.js';
import type { IntegrationProvider } from './integration.types.js';
import {
  collectUnconfiguredFieldErrors,
  collectUnconfiguredTargetErrors,
} from './validation-utils.js';

/**
 * Creates a minimal mock provider with field definitions and validation.
 * Only the fields needed by FieldRegistryService and ConfigValidationService
 * are implemented — the rest are stubs.
 */
function mockProvider(
  overrides: Partial<IntegrationProvider> & Pick<IntegrationProvider, 'name'>,
): IntegrationProvider {
  return {
    getFieldDefinitions: () => ({}),
    validateConfig: () => [],
    ...overrides,
  };
}

/** Creates the standard set of mock providers matching the real app. */
function createProviders(): IntegrationProvider[] {
  return [
    mockProvider({
      name: 'radarr',
      fetchMedia: async () => [],
      executeAction: async () => {},
      getFieldDefinitions: () => radarrFields,
      validateConfig: (config: RoombarrConfig) =>
        collectUnconfiguredTargetErrors(config, 'radarr'),
      getStateFieldPatterns: () => ({
        'state.days_off_import_list': {
          type: 'days_since_value',
          tracks: 'radarr.on_import_list',
          value: 'false',
          nullWhenCurrentNot: true,
          targets: ['radarr'],
        } satisfies StateFieldPattern,
        'state.ever_on_import_list': {
          type: 'ever_was_value',
          tracks: 'radarr.on_import_list',
          value: 'true',
          targets: ['radarr'],
        } satisfies StateFieldPattern,
      }),
    }),
    mockProvider({
      name: 'sonarr',
      fetchMedia: async () => [],
      executeAction: async () => {},
      getFieldDefinitions: () => sonarrFields,
      validateConfig: (config: RoombarrConfig) =>
        collectUnconfiguredTargetErrors(config, 'sonarr'),
    }),
    mockProvider({
      name: 'jellyfin',
      enrichMedia: async items => items,
      getFieldDefinitions: () => jellyfinFields,
      validateConfig(config: RoombarrConfig) {
        if (config.services.jellyfin) return [];
        const errors: string[] = [];
        for (const rule of config.rules) {
          collectUnconfiguredFieldErrors(
            rule.conditions,
            'jellyfin.',
            rule.name,
            'jellyfin',
            errors,
          );
        }
        return errors;
      },
    }),
    mockProvider({
      name: 'jellyseerr',
      enrichMedia: async items => items,
      getFieldDefinitions: () => jellyseerrFields,
      validateConfig(config: RoombarrConfig) {
        if (config.services.jellyseerr) return [];
        const errors: string[] = [];
        for (const rule of config.rules) {
          collectUnconfiguredFieldErrors(
            rule.conditions,
            'jellyseerr.',
            rule.name,
            'jellyseerr',
            errors,
          );
        }
        return errors;
      },
    }),
  ];
}

/** Creates a ConfigValidationService backed by mock providers and a real FieldRegistryService. */
function createService() {
  const providers = createProviders();
  const fieldRegistryService = new FieldRegistryService(providers);
  // ConfigService is not needed for validate() — only for onModuleInit()
  const service = new ConfigValidationService(
    null as any,
    fieldRegistryService,
    providers,
  );
  return service;
}

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

function parse(overrides: Record<string, any> = {}) {
  const result = configSchema.safeParse(validConfig(overrides));
  if (!result.success) throw new Error('Schema parse failed');
  return result.data;
}

describe('ConfigValidationService.validate (cross-validation)', () => {
  const service = createService();

  test('passes with valid full config', () => {
    const errors = service.validate(parse());
    expect(errors).toEqual([]);
  });

  test('fails when no arr service is configured', () => {
    const config = parse();
    config.services.sonarr = undefined;
    config.services.radarr = undefined;
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'At least one of services.sonarr or services.radarr',
      ),
    );
  });

  test('fails when sonarr rule targets unconfigured sonarr', () => {
    const config = parse({
      rules: [
        {
          name: 'Sonarr rule',
          target: 'sonarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'sonarr.tags',
                operator: 'includes',
                value: 'test',
              },
            ],
          },
          action: 'keep',
        },
      ],
    });
    config.services.sonarr = undefined;
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'targets sonarr but services.sonarr is not configured',
      ),
    );
  });

  test('fails when radarr rule targets unconfigured radarr', () => {
    const config = parse();
    config.services.radarr = undefined;
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'targets radarr but services.radarr is not configured',
      ),
    );
  });

  test('fails when jellyfin field used without jellyfin configured', () => {
    const config = parse({
      rules: [
        {
          name: 'Uses jellyfin',
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
      ],
    });
    config.services.jellyfin = undefined;
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('requires services.jellyfin to be configured'),
    );
  });

  test('fails when jellyseerr field used without jellyseerr configured', () => {
    const config = parse({
      rules: [
        {
          name: 'Jellyseerr rule',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    config.services.jellyseerr = undefined;
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('requires services.jellyseerr to be configured'),
    );
  });

  test('fails for unknown field path', () => {
    const config = parse({
      rules: [
        {
          name: 'Unknown field',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('unknown field "radarr.nonexistent"'),
    );
  });

  test('fails for incompatible operator and field type', () => {
    const config = parse({
      rules: [
        {
          name: 'Bad operator',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.tags',
                operator: 'older_than',
                value: '30d',
              },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'operator "older_than" is not compatible with field "radarr.tags"',
      ),
    );
  });

  test('fails when is_empty has a value', () => {
    const config = parse({
      rules: [
        {
          name: 'Empty with value',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('operator "is_empty" must not have a value'),
    );
  });

  test('fails when equals has no value', () => {
    const config = parse({
      rules: [
        {
          name: 'Missing value',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.monitored',
                operator: 'equals',
              },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('operator "equals" requires a value'),
    );
  });

  test('fails when temporal operator value is not a string', () => {
    const config = parse({
      rules: [
        {
          name: 'Numeric duration',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.added',
                operator: 'older_than',
                value: 30,
              },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('requires a duration string, got number'),
    );
  });

  test('fails for invalid duration string', () => {
    const config = parse({
      rules: [
        {
          name: 'Bad duration',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('invalid duration "notaduration"'),
    );
  });

  test('validates nested condition fields recursively', () => {
    const config = parse({
      rules: [
        {
          name: 'Nested with bad field',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('unknown field "radarr.fake_field"'),
    );
  });

  test('passes with is_empty and no value', () => {
    const config = parse({
      rules: [
        {
          name: 'Empty tags',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.tags',
                operator: 'is_empty',
              },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });

  test('passes with state fields on radarr target', () => {
    const config = parse({
      rules: [
        {
          name: 'State rule',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });

  test('rejects radarr-specific state fields on sonarr target', () => {
    const config = parse({
      services: {
        sonarr: { base_url: 'http://localhost:8989', api_key: 'key' },
      },
      rules: [
        {
          name: 'State rule on sonarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toContainEqual(
      expect.stringContaining('unknown field "state.days_off_import_list"'),
    );
  });

  test('passes with new radarr import list fields', () => {
    const config = parse({
      rules: [
        {
          name: 'Import list rule',
          target: 'radarr',
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
          action: 'keep',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });

  test('state fields do not require service config', () => {
    const config = parse({
      services: {
        radarr: { base_url: 'http://localhost:7878', api_key: 'key' },
      },
      rules: [
        {
          name: 'State rule no config',
          target: 'radarr',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });

  test('passes with radarr.has_file field', () => {
    const config = parse({
      rules: [
        {
          name: 'Has file rule',
          target: 'radarr',
          conditions: {
            operator: 'AND',
            children: [
              {
                field: 'radarr.has_file',
                operator: 'equals',
                value: true,
              },
            ],
          },
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });

  test('passes with sonarr.season.has_file field', () => {
    const config = parse({
      services: {
        sonarr: { base_url: 'http://localhost:8989', api_key: 'key' },
      },
      rules: [
        {
          name: 'Season has file rule',
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
          action: 'delete',
        },
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });

  test('passes with sonarr season fields', () => {
    const config = parse({
      services: {
        sonarr: { base_url: 'http://localhost:8989', api_key: 'key' },
      },
      rules: [
        {
          name: 'Season rule',
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
      ],
    });
    const errors = service.validate(config);
    expect(errors).toEqual([]);
  });
});
