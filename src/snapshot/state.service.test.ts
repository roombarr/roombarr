import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service.js';
import type { UnifiedMovie, UnifiedSeason } from '../shared/types.js';
import { SnapshotService } from './snapshot.service.js';
import { StateService } from './state.service.js';

function makeMovie(overrides: Record<string, any> = {}): UnifiedMovie {
  return {
    type: 'movie',
    radarr_id: 101,
    tmdb_id: 1,
    imdb_id: 'tt0000001',
    title: 'Test Movie',
    year: 2024,
    radarr: {
      added: '2024-01-01T00:00:00Z',
      size_on_disk: 5_000_000_000,
      has_file: true,
      monitored: true,
      tags: [],
      genres: ['Action'],
      status: 'released',
      year: 2024,
      digital_release: null,
      physical_release: null,
      path: '/movies/test',
      on_import_list: true,
      import_list_ids: [1],
    },
    state: null,
    jellyfin: null,
    jellyseerr: null,
    ...overrides,
  };
}

describe('StateService', () => {
  let dbService: DatabaseService;
  let snapshotService: SnapshotService;
  let stateService: StateService;
  let db: Database;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `roombarr-state-test-${Date.now()}`);
    process.env.DB_PATH = join(testDir, 'roombarr.sqlite');

    dbService = new DatabaseService();
    dbService.onModuleInit();
    db = dbService.getDatabase();

    snapshotService = new SnapshotService(dbService);
    stateService = new StateService(dbService);
  });

  afterEach(() => {
    dbService.onModuleDestroy();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.DB_PATH;
  });

  test('returns items unchanged on first evaluation (no snapshots)', () => {
    const movie = makeMovie();
    const enriched = stateService.enrich([movie]);

    expect(enriched[0]).toBe(movie);
    expect((enriched[0] as UnifiedMovie).state).toBeNull();
  });

  test('populates state after first snapshot exists', async () => {
    const movie = makeMovie();

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
      radarr: { ...makeMovie().radarr, on_import_list: true },
    });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBeNull();
  });

  test('days_off_import_list computes from change history', async () => {
    const movieOn = makeMovie();
    await snapshotService.snapshot([movieOn], new Set(['radarr']));

    // Movie falls off import list
    const movieOff = makeMovie({
      radarr: {
        ...makeMovie().radarr,
        on_import_list: false,
        import_list_ids: [],
      },
    });
    await snapshotService.snapshot([movieOff], new Set(['radarr']));

    // Manually backdate the field_change to 5 days ago for testing
    db.query(
      `UPDATE field_changes
       SET changed_at = datetime('now', '-5 days')
       WHERE field_path = 'radarr.on_import_list' AND new_value = 'false'`,
    ).run();

    const enriched = stateService.enrich([movieOff]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.days_off_import_list).toBe(5);
  });

  test('days_off_import_list is null when never on a list', async () => {
    const movie = makeMovie({
      radarr: {
        ...makeMovie().radarr,
        on_import_list: false,
        import_list_ids: [],
      },
    });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    // Never was on a list, no change history for on_import_list
    expect(state.days_off_import_list).toBeNull();
  });

  test('ever_on_import_list is true when currently on list', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.ever_on_import_list).toBe(true);
  });

  test('ever_on_import_list is true after falling off list', async () => {
    // Was on list
    const movieOn = makeMovie();
    await snapshotService.snapshot([movieOn], new Set(['radarr']));

    // Fell off list
    const movieOff = makeMovie({
      radarr: {
        ...makeMovie().radarr,
        on_import_list: false,
        import_list_ids: [],
      },
    });
    await snapshotService.snapshot([movieOff], new Set(['radarr']));

    const enriched = stateService.enrich([movieOff]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.ever_on_import_list).toBe(true);
  });

  test('ever_on_import_list is false when never on a list', async () => {
    const movie = makeMovie({
      radarr: {
        ...makeMovie().radarr,
        on_import_list: false,
        import_list_ids: [],
      },
    });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const enriched = stateService.enrich([movie]);
    const state = (enriched[0] as UnifiedMovie).state!;

    expect(state.ever_on_import_list).toBe(false);
  });

  test('returns seasons unchanged when no registry fields target sonarr', async () => {
    const season: UnifiedSeason = {
      type: 'season',
      sonarr_series_id: 201,
      tvdb_id: 100,
      title: 'Test Show - S01',
      year: 2024,
      sonarr: {
        tags: [],
        genres: ['Drama'],
        status: 'continuing',
        year: 2024,
        path: '/tv/test',
        season: {
          season_number: 1,
          monitored: true,
          episode_count: 10,
          episode_file_count: 10,
          has_file: true,
          size_on_disk: 10_000_000_000,
        },
      },
      jellyfin: null,
      jellyseerr: null,
      state: null,
    };

    // Create a snapshot so enrichment would run if applicable
    await snapshotService.snapshot([season], new Set(['sonarr']));

    const enriched = stateService.enrich([season]);
    const enrichedSeason = enriched[0] as UnifiedSeason;
    // No state fields in registry target sonarr yet — state remains null
    expect(enrichedSeason.state).toBeNull();
  });

  test('batch query handles multiple items efficiently', async () => {
    const movie1 = makeMovie({ tmdb_id: 1, title: 'Movie 1' });
    const movie2 = makeMovie({
      tmdb_id: 2,
      title: 'Movie 2',
      radarr: {
        ...makeMovie().radarr,
        on_import_list: false,
        import_list_ids: [],
      },
    });

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
