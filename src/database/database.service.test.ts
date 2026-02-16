import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `roombarr-test-${Date.now()}`);
    process.env.DATA_PATH = testDir;
    service = new DatabaseService();
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
    delete process.env.DATA_PATH;
  });

  test('creates database directory and file on init', () => {
    service.onModuleInit();

    const dbPath = join(testDir, 'roombarr.sqlite');
    expect(existsSync(dbPath)).toBe(true);
  });

  test('sets WAL journal mode', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const result = db
      .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
      .get();
    expect(result!.journal_mode).toBe('wal');
  });

  test('enables foreign keys', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const result = db
      .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
      .get();
    expect(result!.foreign_keys).toBe(1);
  });

  test('sets synchronous to NORMAL', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const result = db
      .query<{ synchronous: number }, []>('PRAGMA synchronous')
      .get();
    // synchronous=NORMAL is 1
    expect(result!.synchronous).toBe(1);
  });

  test('creates media_items table via Drizzle migration', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const table = db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get('media_items');
    expect(table).toBeTruthy();
  });

  test('creates field_changes table with FK', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const table = db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get('field_changes');
    expect(table).toBeTruthy();
  });

  test('creates idx_field_changes_state index', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const idx = db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      )
      .get('idx_field_changes_state');
    expect(idx).toBeTruthy();
  });

  test('exposes Drizzle instance via getDrizzle()', () => {
    service.onModuleInit();
    const drizzleDb = service.getDrizzle();

    expect(drizzleDb).toBeTruthy();
    expect(typeof drizzleDb.select).toBe('function');
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
    service = new DatabaseService();
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

  test('FK cascade deletes field_changes when media_item is deleted', () => {
    service.onModuleInit();
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

  test('closes database on module destroy', () => {
    service.onModuleInit();
    service.onModuleDestroy();

    // Accessing the DB after close should throw
    expect(() => {
      service.getDatabase().query('SELECT 1').get();
    }).toThrow();
  });

  describe('v1 bridge migration', () => {
    test('upgrades v1 database without data loss', () => {
      const dbPath = join(testDir, 'roombarr.sqlite');

      // Create a v1 database manually
      const dir = join(testDir);
      if (!existsSync(dir)) {
        const { mkdirSync } = require('node:fs');
        mkdirSync(dir, { recursive: true });
      }

      const raw = new Database(dbPath, { create: true });
      raw.exec('PRAGMA foreign_keys = ON');
      raw.exec(`
        CREATE TABLE media_snapshots (
          media_type TEXT NOT NULL,
          media_id TEXT NOT NULL,
          title TEXT NOT NULL,
          data TEXT NOT NULL,
          data_hash TEXT NOT NULL,
          first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          missed_evaluations INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (media_type, media_id)
        )
      `);
      raw.exec(`
        CREATE TABLE field_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          media_type TEXT NOT NULL,
          media_id TEXT NOT NULL,
          field_path TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          changed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (media_type, media_id)
            REFERENCES media_snapshots(media_type, media_id)
            ON DELETE CASCADE
        )
      `);
      raw.exec(`
        CREATE INDEX idx_field_changes_lookup
          ON field_changes(media_type, media_id, field_path)
      `);
      raw.exec(`
        CREATE INDEX idx_field_changes_cleanup
          ON field_changes(changed_at)
      `);
      raw.exec('PRAGMA user_version = 1');

      // Insert test data
      raw
        .query(
          `INSERT INTO media_snapshots (media_type, media_id, title, data, data_hash, last_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'movie',
          '42',
          'The Matrix',
          '{"radarr.monitored":true}',
          'abc123',
          '2026-01-15T10:00:00Z',
        );

      raw
        .query(
          `INSERT INTO field_changes (media_type, media_id, field_path, old_value, new_value)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run('movie', '42', 'radarr.monitored', 'true', 'false');

      raw.close();

      // Now initialize DatabaseService — should bridge the v1 database
      service.onModuleInit();
      const db = service.getDatabase();

      // Verify media_items table exists (not media_snapshots)
      const oldTable = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get('media_snapshots');
      expect(oldTable).toBeNull();

      const newTable = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get('media_items');
      expect(newTable).toBeTruthy();

      // Verify data survived
      const item = db
        .query<{ title: string; last_seen_at: string }, [string, string]>(
          'SELECT title, last_seen_at FROM media_items WHERE media_type = ? AND media_id = ?',
        )
        .get('movie', '42');
      expect(item!.title).toBe('The Matrix');
      expect(item!.last_seen_at).toBe('2026-01-15T10:00:00Z');

      // Verify field_changes survived
      const changes = db
        .query<{ field_path: string }, []>(
          'SELECT field_path FROM field_changes',
        )
        .all();
      expect(changes).toHaveLength(1);
      expect(changes[0].field_path).toBe('radarr.monitored');

      // Verify FK integrity
      const violations = db
        .query<Record<string, unknown>, []>('PRAGMA foreign_key_check')
        .all();
      expect(violations).toHaveLength(0);

      // Verify no empty last_seen_at
      const emptyCount = db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) as count FROM media_items WHERE last_seen_at = ''",
        )
        .get();
      expect(emptyCount!.count).toBe(0);

      // Verify journal was seeded
      const journalCount = db
        .query<{ count: number }, []>(
          'SELECT COUNT(*) as count FROM __drizzle_migrations',
        )
        .get();
      expect(journalCount!.count).toBe(1);

      // Verify idx_field_changes_cleanup was dropped
      const oldIdx = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        )
        .get('idx_field_changes_cleanup');
      expect(oldIdx).toBeNull();

      // Verify idx_field_changes_state was created
      const newIdx = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        )
        .get('idx_field_changes_state');
      expect(newIdx).toBeTruthy();

      // Verify user_version was reset
      const version = db
        .query<{ user_version: number }, []>('PRAGMA user_version')
        .get();
      expect(version!.user_version).toBe(0);

      // Verify backup was created
      expect(existsSync(`${dbPath}.backup`)).toBe(true);
    });

    test('re-init on already-bridged database is idempotent', () => {
      // First init — fresh database
      service.onModuleInit();
      const db = service.getDatabase();

      // Insert data
      db.query(
        `INSERT INTO media_items (media_type, media_id, title, data, data_hash, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).run('movie', '1', 'Test', '{}', 'hash');

      service.onModuleDestroy();

      // Second init — should be idempotent
      service = new DatabaseService();
      service.onModuleInit();
      const db2 = service.getDatabase();

      // Data should still be there
      const row = db2
        .query<{ title: string }, [string]>(
          'SELECT title FROM media_items WHERE media_id = ?',
        )
        .get('1');
      expect(row!.title).toBe('Test');

      // Journal should have exactly 1 entry
      const journalCount = db2
        .query<{ count: number }, []>(
          'SELECT COUNT(*) as count FROM __drizzle_migrations',
        )
        .get();
      expect(journalCount!.count).toBe(1);
    });
  });
});
