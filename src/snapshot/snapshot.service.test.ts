import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DatabaseService } from '../database/database.service.js';
import { createTestDatabase, makeMovie } from '../test/index.js';
import { SnapshotService } from './snapshot.service.js';

describe('SnapshotService', () => {
  let dbService: DatabaseService;
  let snapshotService: SnapshotService;
  let db: Database;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    dbService = testDb.dbService;
    cleanup = testDb.cleanup;
    db = dbService.getDatabase();

    snapshotService = new SnapshotService(dbService);
  });

  afterEach(() => {
    cleanup();
  });

  test('creates snapshot for new items', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = db
      .query<{ media_id: string; title: string }, []>(
        'SELECT media_id, title FROM media_items',
      )
      .get();
    expect(row).toBeTruthy();
    expect(row!.media_id).toBe('1');
    expect(row!.title).toBe('Test Movie');
  });

  test('does not generate field_changes on first observation', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const changes = db
      .query<{ id: number }, []>('SELECT id FROM field_changes')
      .all();
    expect(changes).toHaveLength(0);
  });

  test('detects field value changes on subsequent snapshots', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Change monitored from true to false
    const updatedMovie = makeMovie({ radarr: { monitored: false } });
    await snapshotService.snapshot([updatedMovie], new Set(['radarr']));

    const changes = db
      .query<{ field_path: string; old_value: string; new_value: string }, []>(
        'SELECT field_path, old_value, new_value FROM field_changes',
      )
      .all();

    const monitoredChange = changes.find(
      c => c.field_path === 'radarr.monitored',
    );
    expect(monitoredChange).toBeTruthy();
    expect(monitoredChange!.old_value).toBe('true');
    expect(monitoredChange!.new_value).toBe('false');
  });

  test('skips diffing when content hash is unchanged', async () => {
    const movie = makeMovie();

    // First snapshot
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Same movie again — no changes expected
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const changes = db
      .query<{ id: number }, []>('SELECT id FROM field_changes')
      .all();
    expect(changes).toHaveLength(0);
  });

  test('only snapshots fields for hydrated services', async () => {
    const movie = makeMovie({
      jellyfin: {
        watched_by: ['Alice'],
        watched_by_all: false,
        last_played: '2024-06-01T00:00:00Z',
        play_count: 1,
      },
    });

    // Only hydrate radarr, not jellyfin
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = db
      .query<{ data: string }, []>('SELECT data FROM media_items')
      .get();
    const data = JSON.parse(row!.data);

    // Should have radarr fields
    expect(data['radarr.monitored']).toBe(true);
    // Should NOT have jellyfin fields
    expect(data['jellyfin.play_count']).toBeUndefined();
  });

  test('preserves non-hydrated service fields on subsequent snapshots', async () => {
    const movie = makeMovie({
      jellyfin: {
        watched_by: ['Alice'],
        watched_by_all: false,
        last_played: '2024-06-01T00:00:00Z',
        play_count: 1,
      },
    });

    // First snapshot with both services hydrated
    await snapshotService.snapshot([movie], new Set(['radarr', 'jellyfin']));

    // Second snapshot with only radarr hydrated (jellyfin API was down)
    const movieNoJellyfin = makeMovie();
    await snapshotService.snapshot([movieNoJellyfin], new Set(['radarr']));

    const row = db
      .query<{ data: string }, []>('SELECT data FROM media_items')
      .get();
    const data = JSON.parse(row!.data);

    // Radarr fields should be current
    expect(data['radarr.monitored']).toBe(true);
    // Jellyfin fields should be preserved from previous snapshot
    expect(data['jellyfin.play_count']).toBe(1);
  });

  test('increments missed_evaluations for absent items', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Next evaluation with no items
    await snapshotService.snapshot([], new Set(['radarr']));

    const row = db
      .query<{ missed_evaluations: number }, []>(
        'SELECT missed_evaluations FROM media_items',
      )
      .get();
    expect(row!.missed_evaluations).toBe(1);
  });

  test('resets missed_evaluations when item reappears', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Disappear for one eval
    await snapshotService.snapshot([], new Set(['radarr']));

    // Reappear
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = db
      .query<{ missed_evaluations: number }, []>(
        'SELECT missed_evaluations FROM media_items',
      )
      .get();
    expect(row!.missed_evaluations).toBe(0);
  });

  test('deletes orphan snapshots after grace period', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Simulate 8 evaluations without the item (grace = 7)
    for (let i = 0; i < 8; i++) {
      await snapshotService.snapshot([], new Set(['radarr']));
    }

    const count = db
      .query<{ count: number }, []>('SELECT COUNT(*) as count FROM media_items')
      .get();
    expect(count!.count).toBe(0);
  });

  test('sorts arrays before diffing to avoid phantom changes', async () => {
    const movie = makeMovie({ radarr: { tags: ['action', 'sci-fi'] } });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Same tags in different order — should NOT produce a change
    const reorderedMovie = makeMovie({
      radarr: { tags: ['sci-fi', 'action'] },
    });
    await snapshotService.snapshot([reorderedMovie], new Set(['radarr']));

    const changes = db
      .query<{ field_path: string }, []>(
        "SELECT field_path FROM field_changes WHERE field_path = 'radarr.tags'",
      )
      .all();
    expect(changes).toHaveLength(0);
  });

  test('handles multiple items in single snapshot', async () => {
    const movie1 = makeMovie({ radarr_id: 1, tmdb_id: 1, title: 'Movie 1' });
    const movie2 = makeMovie({ radarr_id: 2, tmdb_id: 2, title: 'Movie 2' });
    await snapshotService.snapshot([movie1, movie2], new Set(['radarr']));

    const count = db
      .query<{ count: number }, []>('SELECT COUNT(*) as count FROM media_items')
      .get();
    expect(count!.count).toBe(2);
  });

  test('sets last_seen_at on every upsert', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = db
      .query<{ last_seen_at: string }, []>(
        'SELECT last_seen_at FROM media_items',
      )
      .get();
    expect(row!.last_seen_at).toBeTruthy();
    // Should be an ISO timestamp
    expect(new Date(row!.last_seen_at).toISOString()).toBe(row!.last_seen_at);
  });
});
