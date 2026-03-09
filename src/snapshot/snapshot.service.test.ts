import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { count, eq, like } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as schema from '../database/schema.js';
import { fieldChanges, mediaItems } from '../database/schema.js';
import {
  createTestDatabase,
  makeJellyfinData,
  makeMovie,
} from '../test/index.js';
import { SnapshotService } from './snapshot.service.js';

describe('SnapshotService', () => {
  let snapshotService: SnapshotService;
  let drizzle: BunSQLiteDatabase<typeof schema>;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    cleanup = testDb.cleanup;
    drizzle = testDb.dbService.getDrizzle();

    snapshotService = new SnapshotService(testDb.dbService);
  });

  afterEach(() => {
    cleanup();
  });

  test('creates snapshot for new items', async () => {
    const movie = makeMovie({ tmdb_id: 42, title: 'My Movie' });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = drizzle
      .select({ mediaId: mediaItems.mediaId, title: mediaItems.title })
      .from(mediaItems)
      .get();
    expect(row).toBeTruthy();
    expect(row!.mediaId).toBe('42');
    expect(row!.title).toBe('My Movie');
  });

  test('does not generate field_changes on first observation', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const changes = drizzle
      .select({ id: fieldChanges.id })
      .from(fieldChanges)
      .all();
    expect(changes).toHaveLength(0);
  });

  test('detects field value changes on subsequent snapshots', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Change monitored from true to false
    const updatedMovie = makeMovie({ radarr: { monitored: false } });
    await snapshotService.snapshot([updatedMovie], new Set(['radarr']));

    const changes = drizzle
      .select({
        fieldPath: fieldChanges.fieldPath,
        oldValue: fieldChanges.oldValue,
        newValue: fieldChanges.newValue,
      })
      .from(fieldChanges)
      .all();

    const monitoredChange = changes.find(
      c => c.fieldPath === 'radarr.monitored',
    );
    expect(monitoredChange).toBeTruthy();
    expect(monitoredChange!.oldValue).toBe('true');
    expect(monitoredChange!.newValue).toBe('false');
  });

  test('skips diffing when content hash is unchanged', async () => {
    const movie = makeMovie();

    // First snapshot
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Same movie again — no changes expected
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const changes = drizzle
      .select({ id: fieldChanges.id })
      .from(fieldChanges)
      .all();
    expect(changes).toHaveLength(0);
  });

  test('only snapshots fields for hydrated services', async () => {
    const movie = makeMovie({
      jellyfin: makeJellyfinData(),
    });

    // Only hydrate radarr, not jellyfin
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = drizzle
      .select({ data: mediaItems.data })
      .from(mediaItems)
      .get();
    const data = JSON.parse(row!.data);

    // Should have radarr fields
    expect(data['radarr.monitored']).toBe(true);
    // Should NOT have jellyfin fields
    expect(data['jellyfin.play_count']).toBeUndefined();
  });

  test('preserves non-hydrated service fields on subsequent snapshots', async () => {
    const movie = makeMovie({
      jellyfin: makeJellyfinData(),
    });

    // First snapshot with both services hydrated
    await snapshotService.snapshot([movie], new Set(['radarr', 'jellyfin']));

    // Second snapshot with only radarr hydrated (jellyfin API was down)
    const movieNoJellyfin = makeMovie();
    await snapshotService.snapshot([movieNoJellyfin], new Set(['radarr']));

    const row = drizzle
      .select({ data: mediaItems.data })
      .from(mediaItems)
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

    const row = drizzle
      .select({ missedEvaluations: mediaItems.missedEvaluations })
      .from(mediaItems)
      .get();
    expect(row!.missedEvaluations).toBe(1);
  });

  test('resets missed_evaluations when item reappears', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Disappear for one eval
    await snapshotService.snapshot([], new Set(['radarr']));

    // Reappear
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = drizzle
      .select({ missedEvaluations: mediaItems.missedEvaluations })
      .from(mediaItems)
      .get();
    expect(row!.missedEvaluations).toBe(0);
  });

  test('deletes orphan snapshots after grace period', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Simulate 8 evaluations without the item (grace = 7)
    for (let i = 0; i < 8; i++) {
      await snapshotService.snapshot([], new Set(['radarr']));
    }

    const [row] = drizzle.select({ count: count() }).from(mediaItems).all();
    expect(row.count).toBe(0);
  });

  test('sorts arrays before diffing to avoid phantom changes', async () => {
    const movie = makeMovie({ radarr: { tags: ['action', 'sci-fi'] } });
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Same tags in different order — should NOT produce a change
    const reorderedMovie = makeMovie({
      radarr: { tags: ['sci-fi', 'action'] },
    });
    await snapshotService.snapshot([reorderedMovie], new Set(['radarr']));

    const changes = drizzle
      .select({ fieldPath: fieldChanges.fieldPath })
      .from(fieldChanges)
      .where(eq(fieldChanges.fieldPath, 'radarr.tags'))
      .all();
    expect(changes).toHaveLength(0);
  });

  test('handles multiple items in single snapshot', async () => {
    const movie1 = makeMovie({ radarr_id: 1, tmdb_id: 1, title: 'Movie 1' });
    const movie2 = makeMovie({ radarr_id: 2, tmdb_id: 2, title: 'Movie 2' });
    await snapshotService.snapshot([movie1, movie2], new Set(['radarr']));

    const [row] = drizzle.select({ count: count() }).from(mediaItems).all();
    expect(row.count).toBe(2);
  });

  test('records CREATE diffs when a new service field appears', async () => {
    const movie = makeMovie();

    // First snapshot with only radarr hydrated
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Second snapshot adds jellyfin data and hydrates both services
    const movieWithJellyfin = makeMovie({
      jellyfin: makeJellyfinData(),
    });
    await snapshotService.snapshot(
      [movieWithJellyfin],
      new Set(['radarr', 'jellyfin']),
    );

    const changes = drizzle
      .select({
        fieldPath: fieldChanges.fieldPath,
        oldValue: fieldChanges.oldValue,
        newValue: fieldChanges.newValue,
      })
      .from(fieldChanges)
      .where(like(fieldChanges.fieldPath, 'jellyfin.%'))
      .all();

    // Jellyfin fields are brand-new → CREATE diffs with old_value = null
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(change.oldValue).toBeNull();
      expect(change.newValue).not.toBeNull();
    }

    const playCountChange = changes.find(
      c => c.fieldPath === 'jellyfin.play_count',
    );
    expect(playCountChange).toBeTruthy();
    expect(playCountChange!.newValue).toBe('1');
  });

  test('records REMOVE diffs when a service field disappears', async () => {
    const movieWithJellyfin = makeMovie({
      jellyfin: makeJellyfinData(),
    });

    // First snapshot with both services hydrated
    await snapshotService.snapshot(
      [movieWithJellyfin],
      new Set(['radarr', 'jellyfin']),
    );

    // Second snapshot: both services still hydrated but jellyfin data is null
    const movieNoJellyfin = makeMovie();
    await snapshotService.snapshot(
      [movieNoJellyfin],
      new Set(['radarr', 'jellyfin']),
    );

    const changes = drizzle
      .select({
        fieldPath: fieldChanges.fieldPath,
        oldValue: fieldChanges.oldValue,
        newValue: fieldChanges.newValue,
      })
      .from(fieldChanges)
      .where(like(fieldChanges.fieldPath, 'jellyfin.%'))
      .all();

    // Jellyfin fields removed → REMOVE diffs with new_value = null
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(change.oldValue).not.toBeNull();
      expect(change.newValue).toBeNull();
    }

    const playCountChange = changes.find(
      c => c.fieldPath === 'jellyfin.play_count',
    );
    expect(playCountChange).toBeTruthy();
    expect(playCountChange!.oldValue).toBe('1');
  });

  test('does not delete items at exactly the grace period boundary', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    // Simulate exactly 7 missed evaluations (grace = 7, deletion requires > 7)
    for (let i = 0; i < 7; i++) {
      await snapshotService.snapshot([], new Set(['radarr']));
    }

    const [row] = drizzle.select({ count: count() }).from(mediaItems).all();
    expect(row.count).toBe(1);
  });

  test('sets last_seen_at on every upsert', async () => {
    const movie = makeMovie();
    await snapshotService.snapshot([movie], new Set(['radarr']));

    const row = drizzle
      .select({ lastSeenAt: mediaItems.lastSeenAt })
      .from(mediaItems)
      .get();
    expect(row!.lastSeenAt).toBeTruthy();
    // Should be an ISO timestamp
    expect(new Date(row!.lastSeenAt).toISOString()).toBe(row!.lastSeenAt);
  });
});
