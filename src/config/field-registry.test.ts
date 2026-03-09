import { describe, expect, test } from 'bun:test';
import {
  type FieldType,
  fieldRegistry,
  getFieldDefinition,
  getServiceFromField,
  isOperatorCompatible,
} from './field-registry.js';

describe('fieldRegistry', () => {
  test('radarr registry fields match snapshot', () => {
    expect(Object.keys(fieldRegistry.radarr).sort()).toMatchSnapshot();
  });

  test('sonarr registry fields match snapshot', () => {
    expect(Object.keys(fieldRegistry.sonarr).sort()).toMatchSnapshot();
  });

  test('spot-check date field shape', () => {
    const field = fieldRegistry.radarr['radarr.added'];
    expect(field.type).toBe('date');
    expect(field.service).toBe('radarr');
    expect(field.description).toBeString();
  });

  test('spot-check number field shape', () => {
    const field = fieldRegistry.radarr['radarr.size_on_disk'];
    expect(field.type).toBe('number');
    expect(field.service).toBe('radarr');
    expect(field.description).toBeString();
  });

  test('spot-check boolean field shape', () => {
    const field = fieldRegistry.sonarr['sonarr.season.monitored'];
    expect(field.type).toBe('boolean');
    expect(field.service).toBe('sonarr');
    expect(field.description).toBeString();
  });

  test('spot-check string field shape', () => {
    const field = fieldRegistry.radarr['radarr.status'];
    expect(field.type).toBe('string');
    expect(field.service).toBe('radarr');
    expect(field.description).toBeString();
  });

  test('spot-check array field shape', () => {
    const field = fieldRegistry.sonarr['sonarr.tags'];
    expect(field.type).toBe('array');
    expect(field.service).toBe('sonarr');
    expect(field.description).toBeString();
  });

  test('every field has a non-empty description', () => {
    for (const [_target, fields] of Object.entries(fieldRegistry)) {
      for (const [_fieldPath, def] of Object.entries(fields)) {
        expect(def.description).toBeString();
        expect(def.description!.length).toBeGreaterThan(0);
      }
    }
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
    const def = getFieldDefinition('radarr', 'radarr.added');
    expect(def?.type).toBe('date');
    expect(def?.service).toBe('radarr');
  });

  test('returns correct definition for sonarr native field', () => {
    const def = getFieldDefinition('sonarr', 'sonarr.season.episode_count');
    expect(def?.type).toBe('number');
    expect(def?.service).toBe('sonarr');
  });

  test('returns correct definition for enrichment field', () => {
    const def = getFieldDefinition('radarr', 'jellyfin.play_count');
    expect(def?.type).toBe('number');
    expect(def?.service).toBe('jellyfin');
  });

  test('returns correct definition for state field', () => {
    const def = getFieldDefinition('radarr', 'state.days_off_import_list');
    expect(def?.type).toBe('number');
    expect(def?.service).toBe('state');
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
