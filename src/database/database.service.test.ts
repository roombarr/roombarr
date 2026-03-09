import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaItems } from '../database/schema.js';
import { createTestDatabase } from '../test/index.js';
import { DatabaseService } from './database.service.js';

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

    test('provides access to the underlying database', () => {
      const db = service.getDatabase();
      expect(db).toBeTruthy();
    });

    test('sets WAL journal mode', () => {
      const db = service.getDatabase();

      const result = db
        .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
        .get();
      expect(result!.journal_mode).toBe('wal');
    });

    test('enables foreign keys', () => {
      const db = service.getDatabase();

      const result = db
        .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
        .get();
      expect(result!.foreign_keys).toBe(1);
    });

    test('sets synchronous to NORMAL', () => {
      const db = service.getDatabase();

      const result = db
        .query<{ synchronous: number }, []>('PRAGMA synchronous')
        .get();
      // synchronous=NORMAL is 1
      expect(result!.synchronous).toBe(1);
    });

    test('creates media_items table via Drizzle migration', () => {
      const db = service.getDatabase();

      const table = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get('media_items');
      expect(table).toBeTruthy();
    });

    test('creates field_changes table with FK', () => {
      const db = service.getDatabase();

      const table = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get('field_changes');
      expect(table).toBeTruthy();
    });

    test('creates idx_field_changes_state index', () => {
      const db = service.getDatabase();

      const idx = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        )
        .get('idx_field_changes_state');
      expect(idx).toBeTruthy();
    });

    test('exposes Drizzle instance via getDrizzle()', () => {
      const drizzleDb = service.getDrizzle();

      expect(drizzleDb).toBeTruthy();
      const rows = drizzleDb.select().from(mediaItems).all();
      expect(rows).toBeDefined();
      expect(rows.length).toBeGreaterThanOrEqual(0);
    });

    test('FK cascade deletes field_changes when media_item is deleted', () => {
      const db = service.getDatabase();

      // Insert a media item
      db.query(
        `INSERT INTO media_items (media_type, media_id, title, data, data_hash, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run('movie', '1', 'Test', '{}', 'hash');

      // Insert a field change referencing it
      db.query(
        `INSERT INTO field_changes (media_type, media_id, field_path, old_value, new_value, changed_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      ).run('movie', '1', 'radarr.monitored', 'true', 'false');

      // Delete the media item
      db.query(
        'DELETE FROM media_items WHERE media_type = ? AND media_id = ?',
      ).run('movie', '1');

      // Field change should be cascade-deleted
      const changes = db
        .query<{ id: number }, [string]>(
          'SELECT id FROM field_changes WHERE media_id = ?',
        )
        .all('1');
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
      const db = service.getDatabase();

      // Insert a test row
      db.query(
        `INSERT INTO media_items (media_type, media_id, title, data, data_hash, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run('movie', '1', 'Test', '{}', 'hash');

      service.onModuleDestroy();

      // Re-init
      service = new DatabaseService(dbPath);
      service.onModuleInit();
      const db2 = service.getDatabase();

      // Data should still be there
      const row = db2
        .query<{ title: string }, [string]>(
          'SELECT title FROM media_items WHERE media_id = ?',
        )
        .get('1');
      expect(row!.title).toBe('Test');
    });

    test('closes database on module destroy', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      // Accessing the DB after close should throw
      expect(() => {
        service.getDatabase().query('SELECT 1').get();
      }).toThrow();
    });
  });
});
