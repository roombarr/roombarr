import { describe, expect, test } from 'bun:test';
import {
  type FieldType,
  fieldRegistry,
  getFieldDefinition,
  getServiceFromField,
  isOperatorCompatible,
} from './field-registry.js';

describe('fieldRegistry', () => {
  test('radarr registry contains 21 fields', () => {
    expect(Object.keys(fieldRegistry.radarr)).toHaveLength(21);
  });

  test('sonarr registry contains 19 fields', () => {
    expect(Object.keys(fieldRegistry.sonarr)).toHaveLength(19);
  });

  test('spot-check date field shape', () => {
    expect(fieldRegistry.radarr['radarr.added']).toEqual({
      type: 'date',
      service: 'radarr',
    });
  });

  test('spot-check number field shape', () => {
    expect(fieldRegistry.radarr['radarr.size_on_disk']).toEqual({
      type: 'number',
      service: 'radarr',
    });
  });

  test('spot-check boolean field shape', () => {
    expect(fieldRegistry.sonarr['sonarr.season.monitored']).toEqual({
      type: 'boolean',
      service: 'sonarr',
    });
  });

  test('spot-check string field shape', () => {
    expect(fieldRegistry.radarr['radarr.status']).toEqual({
      type: 'string',
      service: 'radarr',
    });
  });

  test('spot-check array field shape', () => {
    expect(fieldRegistry.sonarr['sonarr.tags']).toEqual({
      type: 'array',
      service: 'sonarr',
    });
  });

  test('enrichment fields are identical across both targets', () => {
    const enrichmentKeys = [
      'jellyfin.watched_by',
      'jellyfin.watched_by_all',
      'jellyfin.last_played',
      'jellyfin.play_count',
      'jellyseerr.requested_by',
      'jellyseerr.requested_at',
      'jellyseerr.request_status',
    ];

    for (const key of enrichmentKeys) {
      expect(fieldRegistry.radarr[key]).toEqual(fieldRegistry.sonarr[key]);
    }
  });
});

describe('isOperatorCompatible', () => {
  const compatibilityMatrix: Array<{
    operator: string;
    compatible: FieldType[];
    incompatible: FieldType[];
  }> = [
    {
      operator: 'equals',
      compatible: ['string', 'number', 'boolean'],
      incompatible: ['date', 'array'],
    },
    {
      operator: 'not_equals',
      compatible: ['string', 'number', 'boolean'],
      incompatible: ['date', 'array'],
    },
    {
      operator: 'greater_than',
      compatible: ['number'],
      incompatible: ['string', 'boolean', 'date', 'array'],
    },
    {
      operator: 'less_than',
      compatible: ['number'],
      incompatible: ['string', 'boolean', 'date', 'array'],
    },
    {
      operator: 'older_than',
      compatible: ['date'],
      incompatible: ['string', 'number', 'boolean', 'array'],
    },
    {
      operator: 'newer_than',
      compatible: ['date'],
      incompatible: ['string', 'number', 'boolean', 'array'],
    },
    {
      operator: 'includes',
      compatible: ['array'],
      incompatible: ['string', 'number', 'boolean', 'date'],
    },
    {
      operator: 'not_includes',
      compatible: ['array'],
      incompatible: ['string', 'number', 'boolean', 'date'],
    },
    {
      operator: 'includes_all',
      compatible: ['array'],
      incompatible: ['string', 'number', 'boolean', 'date'],
    },
    {
      operator: 'is_empty',
      compatible: ['array'],
      incompatible: ['string', 'number', 'boolean', 'date'],
    },
    {
      operator: 'is_not_empty',
      compatible: ['array'],
      incompatible: ['string', 'number', 'boolean', 'date'],
    },
  ];

  for (const { operator, compatible, incompatible } of compatibilityMatrix) {
    describe(operator, () => {
      for (const type of compatible) {
        test(`compatible with ${type}`, () => {
          expect(isOperatorCompatible(operator, type)).toBe(true);
        });
      }

      for (const type of incompatible) {
        test(`incompatible with ${type}`, () => {
          expect(isOperatorCompatible(operator, type)).toBe(false);
        });
      }
    });
  }

  test('unknown operator returns false', () => {
    expect(isOperatorCompatible('nonexistent', 'string')).toBe(false);
  });

  test('empty string operator returns false', () => {
    expect(isOperatorCompatible('', 'string')).toBe(false);
  });
});

describe('getFieldDefinition', () => {
  test('returns correct definition for radarr native field', () => {
    expect(getFieldDefinition('radarr', 'radarr.added')).toEqual({
      type: 'date',
      service: 'radarr',
    });
  });

  test('returns correct definition for sonarr native field', () => {
    expect(getFieldDefinition('sonarr', 'sonarr.season.episode_count')).toEqual(
      {
        type: 'number',
        service: 'sonarr',
      },
    );
  });

  test('returns correct definition for enrichment field', () => {
    expect(getFieldDefinition('radarr', 'jellyfin.play_count')).toEqual({
      type: 'number',
      service: 'jellyfin',
    });
  });

  test('returns correct definition for state field', () => {
    expect(getFieldDefinition('radarr', 'state.days_off_import_list')).toEqual({
      type: 'number',
      service: 'state',
    });
  });

  test('returns undefined for nonexistent field path', () => {
    expect(getFieldDefinition('radarr', 'radarr.nonexistent')).toBeUndefined();
  });

  test('returns undefined for radarr-native field when target is sonarr', () => {
    expect(getFieldDefinition('sonarr', 'radarr.added')).toBeUndefined();
  });
});

describe('getServiceFromField', () => {
  test('extracts service from simple path', () => {
    expect(getServiceFromField('radarr.added')).toBe('radarr');
  });

  test('extracts service from nested path', () => {
    expect(getServiceFromField('sonarr.season.monitored')).toBe('sonarr');
  });

  test('works for jellyfin prefix', () => {
    expect(getServiceFromField('jellyfin.watched_by')).toBe('jellyfin');
  });

  test('works for jellyseerr prefix', () => {
    expect(getServiceFromField('jellyseerr.requested_by')).toBe('jellyseerr');
  });

  test('works for state prefix', () => {
    expect(getServiceFromField('state.days_off_import_list')).toBe('state');
  });
});
