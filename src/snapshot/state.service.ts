import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { DatabaseService } from '../database/database.service.js';
import type * as schema from '../database/schema.js';
import { fieldChanges, mediaItems } from '../database/schema.js';
import { INTEGRATION_PROVIDER } from '../integration/integration.constants.js';
import type { IntegrationProvider } from '../integration/integration.types.js';
import { resolveField } from '../rules/field-resolver.js';
import type { StateData, UnifiedMedia } from '../shared/types.js';
import type { StateFieldPattern } from './state-registry.js';

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
  private readonly stateFieldRegistry: Record<string, StateFieldPattern>;
  private db!: BunSQLiteDatabase<typeof schema>;

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(INTEGRATION_PROVIDER)
    providers: IntegrationProvider[],
  ) {
    this.stateFieldRegistry = this.collectStateFieldPatterns(providers);
  }

  /** Collects state field patterns from all providers that implement getStateFieldPatterns(). */
  private collectStateFieldPatterns(
    providers: IntegrationProvider[],
  ): Record<string, StateFieldPattern> {
    const registry: Record<string, StateFieldPattern> = {};

    for (const provider of providers) {
      const patterns = provider.getStateFieldPatterns?.();
      if (!patterns) continue;
      Object.assign(registry, patterns);
    }

    return registry;
  }

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

    const relevantEntries = Object.entries(this.stateFieldRegistry).filter(
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

    // Batch-load all known media item keys into a Set to avoid N+1 queries
    const knownMediaKeys = this.loadKnownMediaKeys();

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
        knownMediaKeys,
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
        rows.sort((a, b) =>
          b.changedAt > a.changedAt ? 1 : b.changedAt < a.changedAt ? -1 : 0,
        );
      }
    }

    return index;
  }

  /** Batch-load all known media item composite keys (mediaType:mediaId) into a Set. */
  private loadKnownMediaKeys(): Set<string> {
    const db = this.getDb();
    const rows = db
      .select({ mediaType: mediaItems.mediaType, mediaId: mediaItems.mediaId })
      .from(mediaItems)
      .all();

    const keys = new Set<string>();
    for (const row of rows) {
      keys.add(`${row.mediaType}:${row.mediaId}`);
    }
    return keys;
  }

  /** Compute all applicable state fields for a single item. */
  private computeState(
    item: UnifiedMedia,
    target: 'radarr' | 'sonarr',
    compositeKey: string,
    entries: Array<[string, StateFieldPattern]>,
    changeIndex: Map<string, Map<string, FieldChangeRow[]>>,
    knownMediaKeys: Set<string>,
  ): StateData | null {
    // Check if this item has been snapshotted before (in-memory lookup)
    const mediaType = item.type === 'movie' ? 'movie' : 'season';
    const mediaId = compositeKey.split(':')[1];
    if (!knownMediaKeys.has(`${mediaType}:${mediaId}`)) return null;

    const itemChanges = changeIndex.get(compositeKey);
    const result: Record<string, unknown> = {};

    for (const [fieldName, pattern] of entries) {
      if (!pattern.targets.includes(target)) continue;

      const pathChanges = itemChanges?.get(pattern.tracks) ?? [];

      switch (pattern.type) {
        case 'days_since_value':
          result[fieldName] = this.computeDaysSinceValue(
            item,
            pattern,
            pathChanges,
          );
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

    // Strip the "state." prefix from field names so consumers access e.g. state.days_off_import_list
    const state: StateData = {};
    for (const [key, value] of Object.entries(result)) {
      const shortKey = key.startsWith('state.') ? key.slice(6) : key;
      state[shortKey] = value;
    }

    return Object.keys(state).length > 0 ? state : null;
  }

  /**
   * Compute days since a field last changed to a specific value.
   * Returns null if the current value doesn't match the trigger condition.
   */
  private computeDaysSinceValue(
    item: UnifiedMedia,
    pattern: Extract<StateFieldPattern, { type: 'days_since_value' }>,
    changes: FieldChangeRow[],
  ): number | null {
    // Check the live value against nullWhenCurrentNot
    if (pattern.nullWhenCurrentNot) {
      const { value: currentValue, resolved } = resolveField(
        item,
        pattern.tracks,
      );
      if (!resolved) return null;

      const currentSerialized = JSON.stringify(currentValue);
      if (currentSerialized !== pattern.value) return null;
    }

    // Find the most recent change where new_value matches the target value
    const match = changes.find(c => c.newValue === pattern.value);
    if (!match) return null;

    const changedAt = new Date(match.changedAt);
    const now = new Date();
    const diffMs = now.getTime() - changedAt.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
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
