import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema.js';

const DEFAULT_DB_PATH = '/config/roombarr.sqlite';

/**
 * Path to drizzle migration files. Resolved relative to process.cwd()
 * in production (shipped in Docker image) or from project root in dev.
 */
const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle');

interface JournalEntry {
  tag: string;
  when: number;
}

interface Journal {
  entries: JournalEntry[];
}

/**
 * Manages the SQLite database lifecycle: connection, PRAGMAs,
 * schema migrations, and clean shutdown.
 *
 * Wraps bun:sqlite with Drizzle ORM for type-safe query building.
 * Handles v1-to-Drizzle bridge migration for existing databases.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: Database;
  private drizzleDb!: BunSQLiteDatabase<typeof schema>;
  private readonly dbPath: string;

  constructor() {
    this.dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  }

  onModuleInit() {
    this.logger.log(`Initializing SQLite database at ${this.dbPath}`);

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath, { create: true });
    this.configurePragmas();
    this.bridgeV1Database();

    this.drizzleDb = drizzle({ client: this.db, schema });
    migrate(this.drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });

    this.logger.log('Database initialized successfully');
  }

  onModuleDestroy() {
    this.logger.log('Closing database connection');
    this.db.close();
  }

  /** Expose the Drizzle instance for type-safe query building. */
  getDrizzle(): BunSQLiteDatabase<typeof schema> {
    return this.drizzleDb;
  }

  /**
   * Expose the raw Database instance for services that need direct access.
   * @deprecated Migrate consumers to getDrizzle() — will be removed in Phase 5.
   */
  getDatabase(): Database {
    return this.db;
  }

  private configurePragmas() {
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');

    const fkResult = this.db
      .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
      .get();
    if (fkResult?.foreign_keys !== 1) {
      this.logger.warn(
        'PRAGMA foreign_keys could not be enabled — FK constraints will not be enforced',
      );
    }
  }

  /**
   * Bridge a pre-existing v1 database (manual PRAGMA user_version migrations)
   * to the Drizzle-managed schema. After this runs, the database matches
   * what Drizzle's initial migration expects, and the journal is seeded
   * so Drizzle treats it as already applied.
   */
  private bridgeV1Database() {
    const currentVersion =
      this.db.query<{ user_version: number }, []>('PRAGMA user_version').get()
        ?.user_version ?? 0;

    if (currentVersion === 0) {
      // Either fresh install or already-bridged database.
      // Check if tables exist — if media_items exists, journal may need seeding.
      const mediaItemsExists = this.tableExists('media_items');
      if (mediaItemsExists) {
        this.ensureJournalSeeded();
      }
      // Fresh install: drizzle migrate() handles everything.
      return;
    }

    // v1 database detected — run bridge migration
    this.logger.log(
      `V1 database detected (user_version=${currentVersion}), running bridge migration`,
    );

    // Backup before any changes
    this.backupDatabase();

    const hasOldTable = this.tableExists('media_snapshots');
    if (!hasOldTable) {
      // media_snapshots already renamed (partial bridge?) — just seed journal
      this.logger.warn(
        'V1 database has user_version set but media_snapshots table is missing. ' +
          'Assuming partial bridge — seeding journal and resetting user_version.',
      );
      this.db.exec('PRAGMA user_version = 0');
      this.ensureJournalSeeded();
      return;
    }

    // Rename with FK ON so SQLite auto-updates FK references in field_changes
    this.db.exec('ALTER TABLE media_snapshots RENAME TO media_items');

    // FK must be OFF for remaining DDL (ADD/DROP COLUMN)
    this.db.exec('PRAGMA foreign_keys = OFF');

    this.db.transaction(() => {
      // Add last_seen_at with NOT NULL DEFAULT (required by SQLite)
      this.db.exec(
        "ALTER TABLE media_items ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''",
      );

      // Backfill from last_updated_at
      this.db.exec('UPDATE media_items SET last_seen_at = last_updated_at');

      // Drop the old column
      this.db.exec('ALTER TABLE media_items DROP COLUMN last_updated_at');

      // Drop index that only served retention cleanup
      this.db.exec('DROP INDEX IF EXISTS idx_field_changes_cleanup');

      // Create the new state query index
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_field_changes_state ON field_changes (field_path, changed_at)',
      );

      // Reset user_version so it doesn't conflict with Drizzle
      this.db.exec('PRAGMA user_version = 0');

      // Seed the Drizzle journal
      this.seedJournal();
    })();

    // Re-enable FK enforcement
    this.db.exec('PRAGMA foreign_keys = ON');

    // Verify FK integrity
    const violations = this.db
      .query<Record<string, unknown>, []>('PRAGMA foreign_key_check')
      .all();
    if (violations.length > 0) {
      this.logger.error(
        `FK integrity check found ${violations.length} violations after bridge migration`,
      );
      throw new Error(
        'Bridge migration left FK violations — restore from backup',
      );
    }

    this.logger.log('V1 bridge migration completed successfully');
  }

  private tableExists(name: string): boolean {
    const result = this.db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get(name);
    return result !== null;
  }

  private backupDatabase() {
    const backupPath = `${this.dbPath}.backup`;
    try {
      copyFileSync(this.dbPath, backupPath);
      this.logger.log(`Database backed up to ${backupPath}`);
    } catch (error) {
      this.logger.warn(`Could not create backup at ${backupPath}: ${error}`);
    }
  }

  /**
   * Read the migration hash and timestamp from drizzle's generated
   * journal metadata, and seed the __drizzle_migrations table.
   */
  private seedJournal() {
    const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as Journal;
    const entry = journal.entries[0];

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )
    `);

    this.db
      .query(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      )
      .run(entry.tag, entry.when);

    this.logger.debug(`Seeded Drizzle journal with migration: ${entry.tag}`);
  }

  /**
   * Ensure the Drizzle journal is seeded for already-bridged databases
   * that may have been restarted before Drizzle migrate() ran.
   */
  private ensureJournalSeeded() {
    const journalExists = this.tableExists('__drizzle_migrations');
    if (journalExists) {
      const count =
        this.db
          .query<{ count: number }, []>(
            'SELECT COUNT(*) as count FROM __drizzle_migrations',
          )
          .get()?.count ?? 0;
      if (count > 0) return; // Already seeded
    }
    this.seedJournal();
  }
}
