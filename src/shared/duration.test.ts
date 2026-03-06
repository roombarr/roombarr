import { describe, expect, test } from 'bun:test';
import { isValidDuration } from './duration.js';

describe('isValidDuration', () => {
  test('accepts positive finite numbers', () => {
    expect(isValidDuration(1000)).toBe(true);
    expect(isValidDuration(86_400_000)).toBe(true);
    expect(isValidDuration(0.5)).toBe(true);
  });

  test('rejects null', () => {
    expect(isValidDuration(null)).toBe(false);
  });

  test('rejects zero', () => {
    expect(isValidDuration(0)).toBe(false);
  });

  test('rejects negative values', () => {
    expect(isValidDuration(-1)).toBe(false);
    expect(isValidDuration(-86_400_000)).toBe(false);
  });

  test('rejects Infinity', () => {
    expect(isValidDuration(Infinity)).toBe(false);
    expect(isValidDuration(-Infinity)).toBe(false);
  });

  test('rejects NaN', () => {
    expect(isValidDuration(NaN)).toBe(false);
  });
});
