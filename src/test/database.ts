import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service.js';

interface TestDatabase {
  dbService: DatabaseService;
  cleanup: () => void;
}

/**
 * Creates an isolated `DatabaseService` backed by a temporary SQLite file.
 *
 * Returns the service instance and a `cleanup` function that tears down
 * the database connection, removes the temp directory, and unsets `DB_PATH`.
 *
 * @example
 * ```ts
 * let db: TestDatabase;
 * beforeEach(() => { db = createTestDatabase(); });
 * afterEach(() => { db.cleanup(); });
 * ```
 */
export function createTestDatabase(): TestDatabase {
  const testDir = join(tmpdir(), `roombarr-test-${Date.now()}`);
  process.env.DB_PATH = join(testDir, 'roombarr.sqlite');

  const dbService = new DatabaseService();
  dbService.onModuleInit();

  const cleanup = () => {
    dbService.onModuleDestroy();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.DB_PATH;
  };

  return { dbService, cleanup };
}
