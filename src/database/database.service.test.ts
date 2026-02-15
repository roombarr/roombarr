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

  test('creates media_snapshots table', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const table = db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get('media_snapshots');
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

  test('sets user_version to 1 after migration', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    const result = db
      .query<{ user_version: number }, []>('PRAGMA user_version')
      .get();
    expect(result!.user_version).toBe(1);
  });

  test('does not re-run migrations on second init', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    // Insert a test row
    db.query(
      `INSERT INTO media_snapshots (media_type, media_id, title, data, data_hash)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('movie', '1', 'Test', '{}', 'hash');

    service.onModuleDestroy();

    // Re-init
    service = new DatabaseService();
    service.onModuleInit();
    const db2 = service.getDatabase();

    // Data should still be there
    const row = db2
      .query<{ title: string }, [string]>(
        'SELECT title FROM media_snapshots WHERE media_id = ?',
      )
      .get('1');
    expect(row!.title).toBe('Test');
  });

  test('FK cascade deletes field_changes when snapshot is deleted', () => {
    service.onModuleInit();
    const db = service.getDatabase();

    // Insert a snapshot
    db.query(
      `INSERT INTO media_snapshots (media_type, media_id, title, data, data_hash)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('movie', '1', 'Test', '{}', 'hash');

    // Insert a field change referencing it
    db.query(
      `INSERT INTO field_changes (media_type, media_id, field_path, old_value, new_value)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('movie', '1', 'radarr.monitored', 'true', 'false');

    // Delete the snapshot
    db.query(
      'DELETE FROM media_snapshots WHERE media_type = ? AND media_id = ?',
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
});
