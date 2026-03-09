import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as schema from '../database/schema.js';
import { fieldChanges } from '../database/schema.js';
import type { UnifiedMedia, UnifiedMovie } from '../shared/types.js';
import { createTestDatabase, makeMovie } from '../test/index.js';
import { SnapshotService } from './snapshot.service.js';
import { StateService } from './state.service.js';

describe('Snapshot → State integration', () => {
  let snapshotService: SnapshotService;
  let stateService: StateService;
  let drizzle: BunSQLiteDatabase<typeof schema>;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    cleanup = testDb.cleanup;
    drizzle = testDb.dbService.getDrizzle();

    snapshotService = new SnapshotService(testDb.dbService);
    stateService = new StateService(testDb.dbService);
  });

  afterEach(() => {
    cleanup();
  });

  const services = new Set(['radarr']);

  /**
   * Run one evaluation cycle: snapshot the items, then enrich them with state.
   * Encapsulates the two-step pipeline so multi-cycle tests stay concise.
   */
  async function cycle(items: UnifiedMedia[]): Promise<UnifiedMedia[]> {
    await snapshotService.snapshot(items, services);
    return stateService.enrich(items);
  }

  test('enrich returns null state before any snapshots, populated state after first cycle', async () => {
    const movie = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });

    // Before any snapshots exist, enrich returns null state
    const before = stateService.enrich([movie]);
    expect((before[0] as UnifiedMovie).state).toBeNull();

    // After the first full cycle (snapshot → enrich), state is populated
    const after = await cycle([movie]);
    const state = (after[0] as UnifiedMovie).state!;

    expect(state).toBeTruthy();
    expect(state.ever_on_import_list).toBe(true);
    expect(state.days_off_import_list).toBeNull();
  });

  test('days_off_import_list is 0 immediately after falling off list', async () => {
    const movieOn = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    const movieOff = makeMovie();

    // Cycle 1: seed with on_import_list: true
    await cycle([movieOn]);

    // Cycle 2: still on list — establishes baseline snapshot
    await cycle([movieOn]);

    // Cycle 3: falls off the list
    const result = await cycle([movieOff]);
    const state = (result[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBe(0);
    expect(state.ever_on_import_list).toBe(true);
  });

  test('days_off_import_list reflects elapsed time via backdating', async () => {
    const movieOn = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    const movieOff = makeMovie();

    // Seed → establish snapshot → fall off list
    await cycle([movieOn]);
    await cycle([movieOn]);
    await snapshotService.snapshot([movieOff], services);

    // Backdate the field_change to 3 days ago
    drizzle
      .update(fieldChanges)
      .set({ changedAt: sql`datetime('now', '-3 days')` })
      .where(
        and(
          eq(fieldChanges.fieldPath, 'radarr.on_import_list'),
          eq(fieldChanges.newValue, 'false'),
        ),
      )
      .run();

    const result = stateService.enrich([movieOff]);
    const state = (result[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBe(3);
  });

  test('days_off_import_list resets to null when item returns to import list', async () => {
    const movieOn = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    const movieOff = makeMovie();

    // On list → snapshot established → falls off → back on
    await cycle([movieOn]);
    await cycle([movieOn]);
    await cycle([movieOff]);

    const result = await cycle([movieOn]);
    const state = (result[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBeNull();
    expect(state.ever_on_import_list).toBe(true);
  });

  test('ever_on_import_list persists through many cycles after brief appearance', async () => {
    const movieOn = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    const movieOff = makeMovie();

    // Brief appearance on list
    await cycle([movieOn]);
    await cycle([movieOn]);

    // Three consecutive cycles off list — ever_on should stay true
    for (let i = 0; i < 3; i++) {
      const result = await cycle([movieOff]);
      const state = (result[0] as UnifiedMovie).state!;

      expect(state.ever_on_import_list).toBe(true);
    }
  });

  test('multiple items tracked independently across cycles', async () => {
    const movieA = makeMovie({
      tmdb_id: 1,
      title: 'Movie A',
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    const movieB = makeMovie({
      tmdb_id: 2,
      title: 'Movie B',
    });

    // Cycle 1: seed both
    await cycle([movieA, movieB]);

    // Cycle 2: A stays on list, B stays off
    const result = await cycle([movieA, movieB]);
    const stateA = (result[0] as UnifiedMovie).state!;
    const stateB = (result[1] as UnifiedMovie).state!;

    expect(stateA.ever_on_import_list).toBe(true);
    expect(stateA.days_off_import_list).toBeNull();

    expect(stateB.ever_on_import_list).toBe(false);
    expect(stateB.days_off_import_list).toBeNull();

    // Cycle 3: A falls off, B goes on
    const movieAOff = makeMovie({ tmdb_id: 1, title: 'Movie A' });
    const movieBOn = makeMovie({
      tmdb_id: 2,
      title: 'Movie B',
      radarr: { on_import_list: true, import_list_ids: [2] },
    });

    const diverged = await cycle([movieAOff, movieBOn]);
    const stateA2 = (diverged[0] as UnifiedMovie).state!;
    const stateB2 = (diverged[1] as UnifiedMovie).state!;

    // A: was on, now off
    expect(stateA2.ever_on_import_list).toBe(true);
    expect(stateA2.days_off_import_list).toBe(0);

    // B: just went on
    expect(stateB2.ever_on_import_list).toBe(true);
    expect(stateB2.days_off_import_list).toBeNull();
  });

  test('late-arriving item gets state on its first cycle when other snapshots exist', async () => {
    const movieA = makeMovie({
      tmdb_id: 1,
      title: 'Movie A',
      radarr: { on_import_list: true, import_list_ids: [1] },
    });

    // Cycle 1: only movieA
    await cycle([movieA]);

    // Cycle 2: movieA again + brand-new movieB
    const movieB = makeMovie({ tmdb_id: 2, title: 'Movie B' });
    const result = await cycle([movieA, movieB]);

    const stateA = (result[0] as UnifiedMovie).state!;
    const stateB = (result[1] as UnifiedMovie).state!;

    // movieA has been around for 2 cycles — populated state
    expect(stateA).toBeTruthy();
    expect(stateA.ever_on_import_list).toBe(true);

    // movieB was just snapshot'd this cycle — it has a snapshot row now,
    // so enrich() finds it and returns state (though no change history yet)
    expect(stateB).toBeTruthy();
    expect(stateB.ever_on_import_list).toBe(false);
  });
});
