import { describe, expect, test } from 'bun:test';
import { isValidCron, matchesCron } from './cron.js';

describe('isValidCron', () => {
  test('accepts standard expressions', () => {
    expect(isValidCron('0 3 * * *')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('0 0 1 1 *')).toBe(true);
  });

  test('accepts lists', () => {
    expect(isValidCron('0 3 * * 1,3,5')).toBe(true);
  });

  test('accepts ranges', () => {
    expect(isValidCron('0 9-17 * * *')).toBe(true);
  });

  test('accepts steps', () => {
    expect(isValidCron('*/15 * * * *')).toBe(true);
  });

  test('rejects garbage input', () => {
    expect(isValidCron('banana')).toBe(false);
  });

  test('rejects wrong field count (too few)', () => {
    expect(isValidCron('0 3 * *')).toBe(false);
  });

  test('rejects wrong field count (too many)', () => {
    expect(isValidCron('0 0 0 3 * * *')).toBe(false);
  });

  test('rejects out-of-range minute', () => {
    expect(isValidCron('99 * * * *')).toBe(false);
  });

  test('rejects out-of-range hour', () => {
    expect(isValidCron('* 25 * * *')).toBe(false);
  });

  test('rejects invalid step value', () => {
    expect(isValidCron('*/0 * * * *')).toBe(false);
  });
});

describe('matchesCron', () => {
  test('wildcard matches any date', () => {
    const date = new Date('2025-06-15T10:30:00');
    expect(matchesCron('* * * * *', date)).toBe(true);
  });

  test('matches exact hour and minute', () => {
    const match = new Date('2025-06-15T03:00:00');
    expect(matchesCron('0 3 * * *', match)).toBe(true);
  });

  test('does not match different hour', () => {
    const noMatch = new Date('2025-06-15T04:00:00');
    expect(matchesCron('0 3 * * *', noMatch)).toBe(false);
  });

  test('matches list of days', () => {
    // 2025-06-16 is a Monday (day 1)
    const monday = new Date('2025-06-16T03:00:00');
    expect(matchesCron('0 3 * * 1,3,5', monday)).toBe(true);

    // 2025-06-17 is a Tuesday (day 2)
    const tuesday = new Date('2025-06-17T03:00:00');
    expect(matchesCron('0 3 * * 1,3,5', tuesday)).toBe(false);
  });

  test('matches range of hours', () => {
    const inRange = new Date('2025-06-15T12:00:00');
    expect(matchesCron('0 9-17 * * *', inRange)).toBe(true);

    const outOfRange = new Date('2025-06-15T20:00:00');
    expect(matchesCron('0 9-17 * * *', outOfRange)).toBe(false);
  });

  test('matches step values', () => {
    const min0 = new Date('2025-06-15T10:00:00');
    expect(matchesCron('*/15 * * * *', min0)).toBe(true);

    const min15 = new Date('2025-06-15T10:15:00');
    expect(matchesCron('*/15 * * * *', min15)).toBe(true);

    const min7 = new Date('2025-06-15T10:07:00');
    expect(matchesCron('*/15 * * * *', min7)).toBe(false);
  });

  test('does not match when fields do not align', () => {
    // Expression: minute 30, hour 14, day 1, month 1, any weekday
    // Date: June 15 — wrong month and day
    const date = new Date('2025-06-15T14:30:00');
    expect(matchesCron('30 14 1 1 *', date)).toBe(false);
  });
});
