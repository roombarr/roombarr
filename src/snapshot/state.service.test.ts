import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { fieldChanges } from '../database/schema';
import type { UnifiedMovie, UnifiedSeason } from '../shared/types';
import { makeMovie, makeSeason, useTestDatabase } from '../test/index';
import { SnapshotService } from './snapshot.service';
import { StateService } from './state.service';

describe('StateService', () => {
  const db = useTestDatabase();
  let snapshotService: SnapshotService;
  let stateService: StateService;

  beforeEach(() => {
    snapshotService = new SnapshotService(db.dbService);
    stateService = new StateService(db.dbService);
  });

  test('returns items unchanged on first evaluation (no snapshots)', () => {
    const movie = makeMovie();
    const enriched = stateService.enrich([movie]);

    expect(enriched[0]).toBe(movie);
    expect((enriched[0] as UnifiedMovie).state).toBeNull();
  });

  test('populates state after first snapshot exists', async () => {
    const movie = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });

    // Create initial snapshot
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Enrich
    const enriched = stateService.enrich([movie]);
    const enrichedMovie = enriched[0] as UnifiedMovie;

    expect(enrichedMovie.state).toBeTruthy();
    // Currently on import list
    expect(enrichedMovie.state!.days_off_import_list).toBeNull();
    expect(enrichedMovie.state!.ever_on_import_list).toBe(true);
  });

  test('days_off_import_list is null when currently on a list', async () => {
    const movie = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBeNull();
  });

  test('days_off_import_list computes from change history', async () => {
    const movieOn = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    await snapshotService.snapshot([movieOn], new Set(['radarr']));

    // Movie falls off import list
    const movieOff = makeMovie();
    await snapshotService.snapshot([movieOff], new Set(['radarr']));

    // Manually backdate the field_change to 5 days ago for testing
    db.drizzle
      .update(fieldChanges)
      .set({ changedAt: sql`datetime('now', '-5 days')` })
      .where(
        and(
          eq(fieldChanges.fieldPath, 'radarr.on_import_list'),
          eq(fieldChanges.newValue, 'false'),
        ),
      )
      .run();

    const enriched = stateService.enrich([movieOff]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBe(5);
  });

  test('days_off_import_list is null when never on a list', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    // Never was on a list, no change history for on_import_list
    expect(state.days_off_import_list).toBeNull();
  });

  test('ever_on_import_list is true when currently on list', async () => {
    const movie = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.ever_on_import_list).toBe(true);
  });

  test('ever_on_import_list is true after falling off list', async () => {
    // Was on list
    const movieOn = makeMovie({
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    await snapshotService.snapshot([movieOn], new Set(['radarr']));

    // Fell off list
    const movieOff = makeMovie();
    await snapshotService.snapshot([movieOff], new Set(['radarr']));

    const enriched = stateService.enrich([movieOff]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.ever_on_import_list).toBe(true);
  });

  test('ever_on_import_list is false when never on a list', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.ever_on_import_list).toBe(false);
  });

  test('returns seasons unchanged when no registry fields target sonarr', async () => {
    const season = makeSeason();

    // Create a snapshot so enrichment would run if applicable
    await snapshotService.snapshot([season], new Set(['sonarr']));

    const enriched = stateService.enrich([season]);
    const enrichedSeason = enriched[0] as UnifiedSeason;
    // No state fields in registry target sonarr yet — state remains null
    expect(enrichedSeason.state).toBeNull();
  });

  test('batch query handles multiple items efficiently', async () => {
    const movie1 = makeMovie({
      tmdb_id: 1,
      title: 'Movie 1',
      radarr: { on_import_list: true, import_list_ids: [1] },
    });
    const movie2 = makeMovie({ tmdb_id: 2, title: 'Movie 2' });

    await snapshotService.snapshot([movie1, movie2], new Set(['radarr']));

    const enriched = stateService.enrich([movie1, movie2]);

    // Both should get state
    expect((enriched[0] as UnifiedMovie).state).toBeTruthy();
    expect((enriched[1] as UnifiedMovie).state).toBeTruthy();

    // Movie 1 is on a list
    expect((enriched[0] as UnifiedMovie).state!.ever_on_import_list).toBe(true);
    // Movie 2 was never on a list
    expect((enriched[1] as UnifiedMovie).state!.ever_on_import_list).toBe(
      false,
    );
  });
});
