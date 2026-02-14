import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { operators } from './operators.js';

describe('operators', () => {
  describe('equals', () => {
    test('matches equal strings', () => {
      expect(operators.equals('released', 'released')).toBe(true);
    });

    test('rejects unequal strings', () => {
      expect(operators.equals('released', 'announced')).toBe(false);
    });

    test('matches equal numbers', () => {
      expect(operators.equals(42, 42)).toBe(true);
    });

    test('matches equal booleans', () => {
      expect(operators.equals(true, true)).toBe(true);
    });

    test('rejects type mismatch', () => {
      expect(operators.equals('42', 42)).toBe(false);
    });
  });

  describe('not_equals', () => {
    test('matches unequal values', () => {
      expect(operators.not_equals('a', 'b')).toBe(true);
    });

    test('rejects equal values', () => {
      expect(operators.not_equals('a', 'a')).toBe(false);
    });
  });

  describe('greater_than', () => {
    test('matches when field > value', () => {
      expect(operators.greater_than(100, 50)).toBe(true);
    });

    test('rejects when field <= value', () => {
      expect(operators.greater_than(50, 100)).toBe(false);
      expect(operators.greater_than(50, 50)).toBe(false);
    });
  });

  describe('less_than', () => {
    test('matches when field < value', () => {
      expect(operators.less_than(10, 50)).toBe(true);
    });

    test('rejects when field >= value', () => {
      expect(operators.less_than(50, 10)).toBe(false);
      expect(operators.less_than(50, 50)).toBe(false);
    });
  });

  describe('older_than', () => {
    let realDateNow: () => number;

    beforeEach(() => {
      realDateNow = Date.now;
      // Fix "now" to 2026-06-15T00:00:00Z
      Date.now = () => new Date('2026-06-15T00:00:00Z').getTime();
    });

    afterEach(() => {
      Date.now = realDateNow;
    });

    test('matches dates older than the threshold', () => {
      // 2026-01-01 is ~165 days before 2026-06-15, so older_than 30d = true
      expect(operators.older_than('2026-01-01T00:00:00Z', '30d')).toBe(true);
    });

    test('rejects recent dates', () => {
      // 2026-06-10 is 5 days before 2026-06-15, so older_than 30d = false
      expect(operators.older_than('2026-06-10T00:00:00Z', '30d')).toBe(false);
    });

    test('null date = infinitely old = always matches', () => {
      expect(operators.older_than(null, '30d')).toBe(true);
      expect(operators.older_than(undefined, '30d')).toBe(true);
    });

    test('works with week units', () => {
      // 2026-05-01 is ~6.5 weeks before 2026-06-15
      expect(operators.older_than('2026-05-01T00:00:00Z', '4w')).toBe(true);
    });

    test('works with month units', () => {
      expect(operators.older_than('2025-01-01T00:00:00Z', '6m')).toBe(true);
    });

    test('works with year units', () => {
      expect(operators.older_than('2024-01-01T00:00:00Z', '1y')).toBe(true);
    });
  });

  describe('newer_than', () => {
    let realDateNow: () => number;

    beforeEach(() => {
      realDateNow = Date.now;
      Date.now = () => new Date('2026-06-15T00:00:00Z').getTime();
    });

    afterEach(() => {
      Date.now = realDateNow;
    });

    test('matches recent dates', () => {
      expect(operators.newer_than('2026-06-10T00:00:00Z', '30d')).toBe(true);
    });

    test('rejects old dates', () => {
      expect(operators.newer_than('2026-01-01T00:00:00Z', '30d')).toBe(false);
    });

    test('null date = never played = never newer', () => {
      expect(operators.newer_than(null, '30d')).toBe(false);
      expect(operators.newer_than(undefined, '30d')).toBe(false);
    });
  });

  describe('includes', () => {
    test('matches when array contains value', () => {
      expect(operators.includes(['a', 'b', 'c'], 'b')).toBe(true);
    });

    test('rejects when array does not contain value', () => {
      expect(operators.includes(['a', 'b'], 'c')).toBe(false);
    });

    test('returns false for non-array field', () => {
      expect(operators.includes('not-array', 'a')).toBe(false);
    });
  });

  describe('not_includes', () => {
    test('matches when array does not contain value', () => {
      expect(operators.not_includes(['a', 'b'], 'c')).toBe(true);
    });

    test('rejects when array contains value', () => {
      expect(operators.not_includes(['a', 'b'], 'b')).toBe(false);
    });
  });

  describe('includes_all', () => {
    test('matches when array contains all values', () => {
      expect(operators.includes_all(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
    });

    test('rejects when array is missing some values', () => {
      expect(operators.includes_all(['a', 'b'], ['a', 'c'])).toBe(false);
    });

    test('matches when checking against empty array', () => {
      expect(operators.includes_all(['a', 'b'], [])).toBe(true);
    });
  });

  describe('is_empty', () => {
    test('matches empty array', () => {
      expect(operators.is_empty([], undefined)).toBe(true);
    });

    test('rejects non-empty array', () => {
      expect(operators.is_empty(['a'], undefined)).toBe(false);
    });

    test('returns false for non-array', () => {
      expect(operators.is_empty('', undefined)).toBe(false);
    });
  });

  describe('is_not_empty', () => {
    test('matches non-empty array', () => {
      expect(operators.is_not_empty(['a'], undefined)).toBe(true);
    });

    test('rejects empty array', () => {
      expect(operators.is_not_empty([], undefined)).toBe(false);
    });
  });
});
