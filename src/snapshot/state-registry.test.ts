import { describe, expect, test } from 'bun:test';
import { stateFieldRegistry } from './state-registry.js';

describe('stateFieldRegistry', () => {
  test('has exactly 2 entries', () => {
    expect(Object.keys(stateFieldRegistry)).toHaveLength(2);
  });

  test('contains expected field keys', () => {
    expect(Object.keys(stateFieldRegistry)).toEqual(
      expect.arrayContaining([
        'state.days_off_import_list',
        'state.ever_on_import_list',
      ]),
    );
  });
});

describe('state.days_off_import_list', () => {
  const entry = stateFieldRegistry['state.days_off_import_list'];

  test('has correct full shape', () => {
    expect(entry).toEqual({
      type: 'days_since_value',
      tracks: 'radarr.on_import_list',
      value: 'false',
      nullWhenCurrentNot: true,
      targets: ['radarr'],
    });
  });
});

describe('state.ever_on_import_list', () => {
  const entry = stateFieldRegistry['state.ever_on_import_list'];

  test('has correct full shape', () => {
    expect(entry).toEqual({
      type: 'ever_was_value',
      tracks: 'radarr.on_import_list',
      value: 'true',
      targets: ['radarr'],
    });
  });

  test('does not have nullWhenCurrentNot property', () => {
    expect('nullWhenCurrentNot' in entry).toBe(false);
  });
});

describe('pattern types', () => {
  const entries = Object.values(stateFieldRegistry);

  test('all entries have a valid type discriminant', () => {
    const validTypes = ['days_since_value', 'ever_was_value'];

    for (const entry of entries) {
      expect(validTypes).toContain(entry.type);
    }
  });

  test('all entries have required common fields', () => {
    for (const entry of entries) {
      expect(typeof entry.tracks).toBe('string');
      expect(typeof entry.value).toBe('string');
      expect(Array.isArray(entry.targets)).toBe(true);
      expect(entry.targets.length).toBeGreaterThan(0);
    }
  });
});
