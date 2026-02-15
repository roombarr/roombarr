import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

const DEFAULT_DB_PATH = '/data/roombarr.sqlite';

/**
 * Manages the SQLite database lifecycle: connection, PRAGMAs,
 * schema migrations, and clean shutdown.
 *
 * Uses bun:sqlite which is synchronous and blocks the event loop
 * during writes. This is acceptable for Roombarr's workload —
 * periodic batch evaluations, not high-throughput HTTP.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: Database;
  private readonly dbPath: string;

  constructor() {
    this.dbPath = process.env.DATA_PATH
      ? `${process.env.DATA_PATH}/roombarr.sqlite`
      : DEFAULT_DB_PATH;
  }

  onModuleInit() {
    this.logger.log(`Initializing SQLite database at ${this.dbPath}`);

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath, { create: true });
    this.configurePragmas();
    this.runMigrations();

    this.logger.log('Database initialized successfully');
  }

  onModuleDestroy() {
    this.logger.log('Closing database connection');
    this.db.close();
  }

  /** Expose the raw Database instance for services that need direct access. */
  getDatabase(): Database {
    return this.db;
  }

  private configurePragmas() {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  private runMigrations() {
    const currentVersion =
      this.db.query<{ user_version: number }, []>('PRAGMA user_version').get()
        ?.user_version ?? 0;

    this.logger.debug(`Current schema version: ${currentVersion}`);

    const migrations = [this.migrationV1.bind(this)];

    if (currentVersion >= migrations.length) {
      this.logger.debug('Schema is up to date');
      return;
    }

    this.db.transaction(() => {
      for (let i = currentVersion; i < migrations.length; i++) {
        this.logger.log(`Running migration v${i + 1}`);
        migrations[i]();
      }
      this.db.exec(`PRAGMA user_version = ${migrations.length}`);
    })();

    this.logger.log(`Schema migrated to v${migrations.length}`);
  }

  private migrationV1() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_snapshots (
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS field_changes (
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

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_field_changes_lookup
        ON field_changes(media_type, media_id, field_path)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_field_changes_cleanup
        ON field_changes(changed_at)
    `);
  }
}
