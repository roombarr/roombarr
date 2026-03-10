import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { fieldChanges, mediaItems } from '../database/schema';
import { createTestDatabase } from '../test/index';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  describe('initialization and schema', () => {
    let service: DatabaseService;
    let cleanup: () => void;

    beforeEach(() => {
      const testDb = createTestDatabase();
      service = testDb.dbService;
      cleanup = testDb.cleanup;
    });

    afterEach(() => cleanup());

    test('sets WAL journal mode', () => {
      const db = service.getDrizzle();

      const [result] = db.all<{ journal_mode: string }>(
        sql`PRAGMA journal_mode`,
      );
      expect(result.journal_mode).toBe('wal');
    });

    test('enables foreign keys', () => {
      const db = service.getDrizzle();

      const [result] = db.all<{ foreign_keys: number }>(
        sql`PRAGMA foreign_keys`,
      );
      expect(result.foreign_keys).toBe(1);
    });

    test('sets synchronous to NORMAL', () => {
      const db = service.getDrizzle();

      const [result] = db.all<{ synchronous: number }>(sql`PRAGMA synchronous`);
      // synchronous=NORMAL is 1
      expect(result.synchronous).toBe(1);
    });

    test('creates idx_field_changes_state index', () => {
      const db = service.getDrizzle();

      const [idx] = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_field_changes_state'`,
      );
      expect(idx).toBeTruthy();
    });

    test('FK cascade deletes field_changes when media_item is deleted', () => {
      const db = service.getDrizzle();
      const now = new Date().toISOString();

      // Insert a media item
      db.insert(mediaItems)
        .values({
          mediaType: 'movie',
          mediaId: '1',
          title: 'Test',
          data: '{}',
          dataHash: 'hash',
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .run();

      // Insert a field change referencing it
      db.insert(fieldChanges)
        .values({
          mediaType: 'movie',
          mediaId: '1',
          fieldPath: 'radarr.monitored',
          oldValue: 'true',
          newValue: 'false',
          changedAt: now,
        })
        .run();

      // Delete the media item
      db.delete(mediaItems)
        .where(
          and(eq(mediaItems.mediaType, 'movie'), eq(mediaItems.mediaId, '1')),
        )
        .run();

      // Field change should be cascade-deleted
      const changes = db
        .select()
        .from(fieldChanges)
        .where(eq(fieldChanges.mediaId, '1'))
        .all();
      expect(changes).toHaveLength(0);
    });
  });

  describe('lifecycle', () => {
    let service: DatabaseService;
    let testDir: string;
    let dbPath: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `roombarr-test-${Date.now()}`);
      dbPath = join(testDir, 'roombarr.sqlite');
      service = new DatabaseService(dbPath);
    });

    afterEach(() => {
      try {
        service.onModuleDestroy();
      } catch {
        // Already closed
      }
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true });
      }
    });

    test('does not re-run migrations on second init', () => {
      service.onModuleInit();
      const db = service.getDrizzle();
      const now = new Date().toISOString();

      // Insert a test row
      db.insert(mediaItems)
        .values({
          mediaType: 'movie',
          mediaId: '1',
          title: 'Test',
          data: '{}',
          dataHash: 'hash',
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .run();

      service.onModuleDestroy();

      // Re-init
      service = new DatabaseService(dbPath);
      service.onModuleInit();
      const db2 = service.getDrizzle();

      // Data should still be there
      const row = db2
        .select({ title: mediaItems.title })
        .from(mediaItems)
        .where(eq(mediaItems.mediaId, '1'))
        .get();
      expect(row!.title).toBe('Test');
    });

    test('closes database on module destroy', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      // Accessing the DB after close should throw
      expect(() => {
        service.getDrizzle().select().from(mediaItems).all();
      }).toThrow();
    });
  });
});
