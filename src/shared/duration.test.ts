import { describe, expect, test } from 'bun:test';
import {
  isValidDuration,
  parseDuration,
  subtractDuration,
} from './duration.js';

describe('parseDuration', () => {
  test('parses days', () => {
    expect(parseDuration('30d')).toEqual({ amount: 30, unit: 'd' });
  });

  test('parses weeks', () => {
    expect(parseDuration('2w')).toEqual({ amount: 2, unit: 'w' });
  });

  test('parses months', () => {
    expect(parseDuration('6m')).toEqual({ amount: 6, unit: 'm' });
  });

  test('parses years', () => {
    expect(parseDuration('1y')).toEqual({ amount: 1, unit: 'y' });
  });

  test('parses large numbers', () => {
    expect(parseDuration('365d')).toEqual({ amount: 365, unit: 'd' });
  });

  test('throws on invalid format', () => {
    expect(() => parseDuration('30')).toThrow('Invalid duration format');
    expect(() => parseDuration('d30')).toThrow('Invalid duration format');
    expect(() => parseDuration('abc')).toThrow('Invalid duration format');
    expect(() => parseDuration('')).toThrow('Invalid duration format');
    expect(() => parseDuration('30h')).toThrow('Invalid duration format');
  });
});

describe('subtractDuration', () => {
  const baseDate = new Date('2026-06-15T12:00:00Z');

  test('subtracts days', () => {
    const result = subtractDuration(baseDate, { amount: 30, unit: 'd' });
    expect(result.toISOString()).toBe('2026-05-16T12:00:00.000Z');
  });

  test('subtracts weeks', () => {
    const result = subtractDuration(baseDate, { amount: 2, unit: 'w' });
    expect(result.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  test('subtracts months', () => {
    const result = subtractDuration(baseDate, { amount: 3, unit: 'm' });
    expect(result.toISOString()).toBe('2026-03-15T12:00:00.000Z');
  });

  test('subtracts years', () => {
    const result = subtractDuration(baseDate, { amount: 1, unit: 'y' });
    expect(result.toISOString()).toBe('2025-06-15T12:00:00.000Z');
  });

  test('does not mutate the original date', () => {
    const original = new Date('2026-06-15T12:00:00Z');
    subtractDuration(original, { amount: 30, unit: 'd' });
    expect(original.toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });
});

describe('isValidDuration', () => {
  test('returns true for valid durations', () => {
    expect(isValidDuration('30d')).toBe(true);
    expect(isValidDuration('2w')).toBe(true);
    expect(isValidDuration('6m')).toBe(true);
    expect(isValidDuration('1y')).toBe(true);
  });

  test('returns false for invalid durations', () => {
    expect(isValidDuration('30')).toBe(false);
    expect(isValidDuration('abc')).toBe(false);
    expect(isValidDuration('30h')).toBe(false);
    expect(isValidDuration('')).toBe(false);
  });
});
