import { describe, expect, test } from 'bun:test';
import {
  type GuardImportListInput,
  guardImportListMembership,
} from './import-list-guard';

const NOW = new Date('2026-10-07T03:00:00.000Z');

const trakt = { id: 7, name: 'Trakt Watchlist', enabled: true };

/** A run with list 7 recorded on movies 100, 200 and 300 last run. */
function run(overrides: Partial<GuardImportListInput> = {}) {
  return guardImportListMembership({
    library: [100, 200, 300],
    reported: new Map(),
    recorded: new Map([
      [100, [7]],
      [200, [7]],
      [300, [7]],
    ]),
    lists: [trakt],
    holds: [],
    threshold: 0.5,
    now: NOW,
    ...overrides,
  });
}

describe('guardImportListMembership', () => {
  test('a list that goes empty is held with its recorded membership', () => {
    const result = run();

    expect(result.membership.get(100)).toEqual([7]);
    expect(result.membership.get(200)).toEqual([7]);
    expect(result.membership.get(300)).toEqual([7]);
    expect(result.holds).toEqual([
      {
        listId: 7,
        reason: 'empty',
        trustedSize: 3,
        currentSize: 0,
        heldSince: NOW.toISOString(),
        sizeSince: NOW.toISOString(),
        acknowledged: false,
      },
    ]);
    expect(result.events).toEqual([
      { kind: 'held', list: trakt, hold: result.holds[0] },
    ]);
  });

  test('a list shrinking past the threshold is held as shrunk', () => {
    const result = run({
      library: [100, 200, 300, 400],
      recorded: new Map([
        [100, [7]],
        [200, [7]],
        [300, [7]],
        [400, [7]],
      ]),
      reported: new Map([[100, [7]]]),
      threshold: 0.5,
    });

    expect([...result.membership.keys()]).toEqual([100, 200, 300, 400]);
    expect(result.holds).toMatchObject([
      { listId: 7, reason: 'shrunk', trustedSize: 4, currentSize: 1 },
    ]);
  });

  test('a list shrinking within the threshold is trusted', () => {
    const result = run({
      reported: new Map([
        [100, [7]],
        [200, [7]],
      ]),
      threshold: 0.5,
    });

    expect(result.membership.has(300)).toBe(false);
    expect(result.holds).toEqual([]);
    expect(result.events).toEqual([]);
  });

  test('a list with no recorded movies is trusted at its first reported size', () => {
    const result = run({ recorded: new Map() });

    expect(result.membership.size).toBe(0);
    expect(result.holds).toEqual([]);
    expect(result.events).toEqual([]);
  });

  test('recorded movies no longer in the library do not count toward the trusted size', () => {
    const result = run({
      library: [100],
      reported: new Map([[100, [7]]]),
    });

    expect(result.holds).toEqual([]);
  });

  test('a movie on a held list and a healthy list keeps both', () => {
    const imdb = { id: 8, name: 'IMDb Top 250', enabled: true };
    const result = run({
      lists: [trakt, imdb],
      recorded: new Map([
        [100, [7, 8]],
        [200, [7]],
        [300, [7]],
      ]),
      reported: new Map([[100, [8]]]),
    });

    expect(result.membership.get(100)).toEqual([7, 8]);
    expect(result.membership.get(200)).toEqual([7]);
    expect(result.holds.map(hold => hold.listId)).toEqual([7]);
  });

  test('a movie newly reported on a held list is on it', () => {
    const result = run({
      library: [100, 200, 300, 400, 500, 600, 700],
      reported: new Map([[700, [7]]]),
    });

    expect(result.membership.get(700)).toEqual([7]);
    expect(result.holds).toMatchObject([{ listId: 7, currentSize: 1 }]);
  });

  describe('across runs', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const daysAfter = (days: number) => new Date(NOW.getTime() + days * DAY);
    const shrunkTo100 = new Map([[100, [7]]]);

    /** Run once to hold, then again `days` later with the persisted holds. */
    function rerun(
      days: number,
      overrides: Partial<GuardImportListInput> = {},
    ) {
      const first = run(overrides);
      return run({ ...overrides, holds: first.holds, now: daysAfter(days) });
    }

    test('a held list keeps when it started being held', () => {
      const result = rerun(1);

      expect(result.holds).toMatchObject([
        { heldSince: NOW.toISOString(), sizeSince: NOW.toISOString() },
      ]);
    });

    test('a shrunk list reporting the same size for three days is accepted', () => {
      const result = rerun(3, { reported: shrunkTo100 });

      expect(result.membership.has(200)).toBe(false);
      expect(result.events).toEqual([
        { kind: 'accepted', list: trakt, trustedSize: 3, currentSize: 1 },
      ]);
    });

    test('a shrunk list is still held just short of three days', () => {
      const result = rerun(2.9, { reported: shrunkTo100 });

      expect(result.holds).toMatchObject([{ reason: 'shrunk' }]);
    });

    test('a shrunk list whose size changes restarts its three days', () => {
      const first = run({ reported: shrunkTo100 });
      const second = run({
        holds: first.holds,
        reported: new Map(),
        now: daysAfter(2),
      });
      const third = run({
        holds: second.holds,
        reported: shrunkTo100,
        now: daysAfter(4),
      });

      expect(third.holds).toMatchObject([
        { reason: 'shrunk', sizeSince: daysAfter(4).toISOString() },
      ]);
    });

    test('an empty list is never accepted on its own', () => {
      const result = rerun(30);

      expect(result.holds).toMatchObject([{ reason: 'empty' }]);
      expect(result.membership.get(100)).toEqual([7]);
    });

    test('an acknowledged list is released', () => {
      const first = run();
      const result = run({
        holds: first.holds.map(hold => ({ ...hold, acknowledged: true })),
      });

      expect(result.membership.size).toBe(0);
      expect(result.events).toEqual([
        { kind: 'released', list: trakt, trustedSize: 3, currentSize: 0 },
      ]);
    });

    test('a released list stays released until the snapshot records its movies leaving', () => {
      const first = run();
      const acknowledged = first.holds.map(hold => ({
        ...hold,
        acknowledged: true,
      }));
      const released = run({ holds: acknowledged });
      const unrecorded = run({ holds: released.holds });
      const recorded = run({ holds: unrecorded.holds, recorded: new Map() });

      expect(unrecorded.membership.size).toBe(0);
      expect(unrecorded.events).toMatchObject([{ kind: 'released' }]);
      expect(recorded.holds).toEqual([]);
    });

    test('an accepted list stays accepted until the snapshot records its movies leaving', () => {
      const accepted = rerun(3, { reported: shrunkTo100 });
      const unrecorded = run({
        holds: accepted.holds,
        reported: shrunkTo100,
        now: daysAfter(4),
      });
      const recorded = run({
        holds: unrecorded.holds,
        reported: shrunkTo100,
        recorded: shrunkTo100,
        now: daysAfter(5),
      });

      expect(unrecorded.membership.has(200)).toBe(false);
      expect(unrecorded.events).toMatchObject([{ kind: 'accepted' }]);
      expect(recorded.holds).toEqual([]);
    });

    test('a list that recovers is trusted again', () => {
      const first = run();
      const result = run({
        holds: first.holds,
        reported: new Map([
          [100, [7]],
          [200, [7]],
          [300, [7]],
        ]),
      });

      expect(result.holds).toEqual([]);
      expect(result.events).toEqual([]);
    });

    test('a held list the user disabled in Radarr is released silently', () => {
      const first = run();
      const result = run({
        holds: first.holds,
        lists: [{ ...trakt, enabled: false }],
      });

      expect(result.holds).toEqual([]);
      expect(result.membership.size).toBe(0);
      expect(result.events).toEqual([]);
    });

    test('a held list removed from Radarr is released silently', () => {
      const first = run();
      const result = run({ holds: first.holds, lists: [] });

      expect(result.holds).toEqual([]);
      expect(result.membership.size).toBe(0);
      expect(result.events).toEqual([]);
    });
  });
});
