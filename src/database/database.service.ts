import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema';

const DEFAULT_DB_PATH = '/config/roombarr.sqlite';

/**
 * Path to drizzle migration files. Resolved relative to process.cwd()
 * in production (shipped in Docker image) or from project root in dev.
 */
const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle');

/**
 * Manages the SQLite database lifecycle: connection, PRAGMAs,
 * schema migrations, and clean shutdown.
 *
 * Wraps bun:sqlite with Drizzle ORM for type-safe query building.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: Database;
  private drizzleDb!: BunSQLiteDatabase<typeof schema>;
  private readonly dbPath: string;

  constructor(@Optional() dbPath?: string) {
    this.dbPath = dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH;
  }

  onModuleInit() {
    this.logger.log(`Initializing SQLite database at ${this.dbPath}`);

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath, { create: true });
    this.configurePragmas();

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
}
