import { afterEach, beforeEach } from 'bun:test';
import { randomUUID } from 'node:crypto';
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
 * the database connection and removes the temp directory.
 *
 * @example
 * ```ts
 * let db: TestDatabase;
 * beforeEach(() => { db = createTestDatabase(); });
 * afterEach(() => { db.cleanup(); });
 * ```
 */
export function createTestDatabase(): TestDatabase {
  const testDir = join(tmpdir(), `roombarr-test-${randomUUID()}`);
  const dbService = new DatabaseService(join(testDir, 'roombarr.sqlite'));
  dbService.onModuleInit();

  const cleanup = () => {
    dbService.onModuleDestroy();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  };

  return { dbService, cleanup };
}

/**
 * Registers `beforeEach`/`afterEach` hooks that create and tear down an
 * isolated test database for every test. Returns an object with lazy
 * getters so callers always see the current test's instance.
 *
 * @example
 * ```ts
 * const db = useTestDatabase();
 * test('inserts a row', () => {
 *   db.drizzle.insert(table).values({ … }).run();
 * });
 * ```
 */
export function useTestDatabase() {
  let current: TestDatabase;

  beforeEach(() => {
    current = createTestDatabase();
  });

  afterEach(() => {
    current.cleanup();
  });

  return {
    get dbService() {
      return current.dbService;
    },
    get drizzle() {
      return current.dbService.getDrizzle();
    },
  };
}
