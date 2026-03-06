import { Injectable, Logger } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { DatabaseService } from '../database/database.service.js';
import type * as schema from '../database/schema.js';
import { fieldChanges, mediaItems } from '../database/schema.js';
import { resolveField } from '../rules/field-resolver.js';
import type { StateData, UnifiedMedia } from '../shared/types.js';
import {
  type StateFieldPattern,
  stateFieldRegistry,
} from './state-registry.js';

const IMPORT_LIST_REMOVED_AT_KEY =
  'state.import_list_removed_at' as const satisfies keyof typeof stateFieldRegistry;
const EVER_ON_IMPORT_LIST_KEY =
  'state.ever_on_import_list' as const satisfies keyof typeof stateFieldRegistry;

interface FieldChangeRow {
  mediaType: string;
  mediaId: string;
  fieldPath: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

/**
 * Computes temporal state fields from the field_changes history.
 * Uses the state field registry for data-driven computation —
 * no custom SQL methods needed per field.
 */
@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);
  private db!: BunSQLiteDatabase<typeof schema>;

  constructor(private readonly databaseService: DatabaseService) {}

  private getDb() {
    if (!this.db) {
      this.db = this.databaseService.getDrizzle();
    }
    return this.db;
  }

  /**
   * Enrich unified media items with computed temporal state.
   * Returns the same items with `state` populated.
   */
  enrich(items: UnifiedMedia[]): UnifiedMedia[] {
    const db = this.getDb();

    // Check if any snapshots exist — if not, this is the first evaluation
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(mediaItems)
      .get();
    const snapshotCount = result?.count ?? 0;

    if (snapshotCount === 0) {
      this.logger.debug(
        'No snapshots exist yet (first evaluation), skipping state enrichment',
      );
      return items;
    }

    // Collect all tracked field paths for the items in this batch
    const targetTypes = new Set(
      items.map(item => (item.type === 'movie' ? 'radarr' : 'sonarr')),
    );

    const relevantEntries = Object.entries(stateFieldRegistry).filter(
      ([, pattern]) => pattern.targets.some(t => targetTypes.has(t)),
    );

    if (relevantEntries.length === 0) return items;

    const trackedPaths = [
      ...new Set(relevantEntries.map(([, pattern]) => pattern.tracks)),
    ];

    // Batch query: fetch all relevant field changes in one shot
    const allChanges = db
      .select()
      .from(fieldChanges)
      .where(inArray(fieldChanges.fieldPath, trackedPaths))
      .all() as FieldChangeRow[];

    // Index by composite key → field_path → rows (sorted by changedAt DESC)
    const changeIndex = this.buildChangeIndex(allChanges);

    return items.map(item => {
      const target = item.type === 'movie' ? 'radarr' : 'sonarr';
      const mediaId = this.getMediaId(item);
      const compositeKey = `${item.type}:${mediaId}`;

      const state = this.computeState(
        item,
        target,
        compositeKey,
        relevantEntries,
        changeIndex,
      );

      return { ...item, state };
    });
  }

  /** Build a nested index: compositeKey → fieldPath → sorted FieldChangeRow[]. */
  private buildChangeIndex(
    rows: FieldChangeRow[],
  ): Map<string, Map<string, FieldChangeRow[]>> {
    const index = new Map<string, Map<string, FieldChangeRow[]>>();

    for (const row of rows) {
      const key = `${row.mediaType}:${row.mediaId}`;
      let pathMap = index.get(key);
      if (!pathMap) {
        pathMap = new Map();
        index.set(key, pathMap);
      }
      let pathRows = pathMap.get(row.fieldPath);
      if (!pathRows) {
        pathRows = [];
        pathMap.set(row.fieldPath, pathRows);
      }
      pathRows.push(row);
    }

    // Sort each group by changedAt DESC (in-memory sort is cheaper than SQL ORDER BY)
    for (const pathMap of index.values()) {
      for (const rows of pathMap.values()) {
        rows.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
      }
    }

    return index;
  }

  /** Compute all applicable state fields for a single item. */
  private computeState(
    item: UnifiedMedia,
    target: 'radarr' | 'sonarr',
    compositeKey: string,
    entries: Array<[string, StateFieldPattern]>,
    changeIndex: Map<string, Map<string, FieldChangeRow[]>>,
  ): StateData | null {
    const db = this.getDb();

    // Check if this item has been snapshotted before
    const mediaType = item.type === 'movie' ? 'movie' : 'season';
    const mediaId = compositeKey.split(':')[1];
    const snapshot = db
      .select({ mediaId: mediaItems.mediaId })
      .from(mediaItems)
      .where(
        sql`${mediaItems.mediaType} = ${mediaType} AND ${mediaItems.mediaId} = ${mediaId}`,
      )
      .get();

    if (!snapshot) return null;

    const itemChanges = changeIndex.get(compositeKey);
    const result: Record<string, unknown> = {};

    for (const [fieldName, pattern] of entries) {
      if (!pattern.targets.includes(target)) continue;

      const pathChanges = itemChanges?.get(pattern.tracks) ?? [];

      switch (pattern.type) {
        case 'date_since_value':
          result[fieldName] = this.computeDateSinceValue(pattern, pathChanges);
          break;
        case 'ever_was_value':
          result[fieldName] = this.computeEverWasValue(
            item,
            pattern,
            pathChanges,
          );
          break;
      }
    }

    return {
      import_list_removed_at:
        (result[IMPORT_LIST_REMOVED_AT_KEY] as string | null) ?? null,
      ever_on_import_list:
        (result[EVER_ON_IMPORT_LIST_KEY] as boolean) ?? false,
    };
  }

  /**
   * Compute the ISO date when a field last changed to a specific value.
   * Returns null if no matching change exists in history.
   */
  private computeDateSinceValue(
    pattern: Extract<StateFieldPattern, { type: 'date_since_value' }>,
    changes: FieldChangeRow[],
  ): string | null {
    // Find the most recent change where new_value matches the target value
    const match = changes.find(c => c.newValue === pattern.value);
    if (!match) return null;

    return match.changedAt;
  }

  /**
   * Check if a field ever held a specific value.
   * Checks the current live value first, then scans change history.
   */
  private computeEverWasValue(
    item: UnifiedMedia,
    pattern: Extract<StateFieldPattern, { type: 'ever_was_value' }>,
    changes: FieldChangeRow[],
  ): boolean {
    // Check current live value
    const { value: currentValue, resolved } = resolveField(
      item,
      pattern.tracks,
    );
    if (resolved && JSON.stringify(currentValue) === pattern.value) return true;

    // Check change history — both old_value and new_value
    return changes.some(
      c => c.newValue === pattern.value || c.oldValue === pattern.value,
    );
  }

  /** Extract the media ID for a unified item. */
  private getMediaId(item: UnifiedMedia): string {
    if (item.type === 'movie') {
      return String(item.tmdb_id);
    }
    return `${item.tvdb_id}:${item.sonarr.season.season_number}`;
  }
}
