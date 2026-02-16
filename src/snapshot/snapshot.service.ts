import { Injectable, Logger } from '@nestjs/common';
import { gt, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import diff from 'microdiff';
import { fieldRegistry } from '../config/field-registry.js';
import { DatabaseService } from '../database/database.service.js';
import type * as schema from '../database/schema.js';
import { fieldChanges, mediaItems } from '../database/schema.js';
import { resolveField } from '../rules/field-resolver.js';
import type { UnifiedMedia } from '../shared/types.js';

/** Row shape returned from loading media_items. */
interface SnapshotRow {
  mediaType: string;
  mediaId: string;
  title: string;
  data: string;
  dataHash: string;
  missedEvaluations: number;
}

/** How many evaluations an item can be absent before its snapshot is purged. */
const ORPHAN_GRACE_EVALUATIONS = 7;

/**
 * SQLite supports at most 999 bound parameters per statement.
 * Chunk multi-row inserts to stay under this limit.
 */
const MEDIA_ITEMS_COLUMNS = 8;
const FIELD_CHANGES_COLUMNS = 7;
const MEDIA_ITEMS_CHUNK_SIZE = Math.floor(999 / MEDIA_ITEMS_COLUMNS);
const FIELD_CHANGES_CHUNK_SIZE = Math.floor(999 / FIELD_CHANGES_COLUMNS);

/** Split an array into chunks of a given size. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Persists unified media snapshots to SQLite and tracks
 * field-level changes in an append-only log.
 *
 * Runs after hydration and before rule evaluation each cycle.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);
  private db!: BunSQLiteDatabase<typeof schema>;

  constructor(private readonly databaseService: DatabaseService) {}

  private getDb() {
    if (!this.db) {
      this.db = this.databaseService.getDrizzle();
    }
    return this.db;
  }

  /**
   * Snapshot all unified media items, detect field changes,
   * and clean up orphans.
   *
   * @param items - The current evaluation's hydrated unified models
   * @param hydratedServices - Set of service prefixes that were actually fetched
   *   this cycle (e.g., {'radarr', 'jellyfin'}). Only fields belonging to
   *   these services are diffed/overwritten.
   */
  async snapshot(
    items: UnifiedMedia[],
    hydratedServices: Set<string>,
  ): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();

    // Step 1: Batch-read all existing snapshots into a Map
    const existingSnapshots = this.loadAllSnapshots();

    // Step 2: Build the set of current media IDs (for orphan detection)
    const currentIds = new Set<string>();

    // Step 3: Prepare writes
    const upserts: Array<{
      mediaType: string;
      mediaId: string;
      title: string;
      data: string;
      dataHash: string;
      firstSeenAt: string;
      lastSeenAt: string;
      isNew: boolean;
    }> = [];

    const changes: Array<{
      mediaType: string;
      mediaId: string;
      fieldPath: string;
      oldValue: string | null;
      newValue: string | null;
      changedAt: string;
    }> = [];

    for (const item of items) {
      const mediaType = item.type;
      const mediaId = this.getMediaId(item);
      const compositeKey = `${mediaType}:${mediaId}`;
      currentIds.add(compositeKey);

      // Flatten the item using the field registry
      const flatData = this.flattenItem(item, hydratedServices);
      const dataJson = JSON.stringify(flatData, Object.keys(flatData).sort());
      const dataHash = String(Bun.hash(dataJson));

      const existing = existingSnapshots.get(compositeKey);

      if (!existing) {
        // First observation — insert snapshot, no field_changes
        upserts.push({
          mediaType,
          mediaId,
          title: item.title,
          data: dataJson,
          dataHash,
          firstSeenAt: now,
          lastSeenAt: now,
          isNew: true,
        });
        continue;
      }

      // Content hash skip — if unchanged, just reset missed_evaluations
      if (existing.dataHash === dataHash) {
        if (existing.missedEvaluations > 0) {
          upserts.push({
            mediaType,
            mediaId,
            title: item.title,
            data: existing.data,
            dataHash: existing.dataHash,
            firstSeenAt: now,
            lastSeenAt: now,
            isNew: false,
          });
        }
        continue;
      }

      // Diff against previous snapshot (only hydrated service fields)
      let previousData: Record<string, unknown>;
      try {
        previousData = JSON.parse(existing.data) as Record<string, unknown>;
      } catch {
        this.logger.warn(
          `Corrupt data for ${mediaType}/${mediaId}, treating as empty`,
        );
        previousData = {};
      }
      const currentFiltered = this.filterByServices(flatData, hydratedServices);
      const previousFiltered = this.filterByServices(
        previousData,
        hydratedServices,
      );

      // Sort arrays before diffing to avoid phantom changes
      const sortedCurrent = this.sortArrayValues(currentFiltered);
      const sortedPrevious = this.sortArrayValues(previousFiltered);

      const diffs = diff(sortedPrevious, sortedCurrent);

      for (const d of diffs) {
        const fieldPath = d.path.join('.');
        if (d.type === 'CHANGE') {
          changes.push({
            mediaType,
            mediaId,
            fieldPath,
            oldValue: JSON.stringify(d.oldValue),
            newValue: JSON.stringify(d.value),
            changedAt: now,
          });
        } else if (d.type === 'CREATE') {
          changes.push({
            mediaType,
            mediaId,
            fieldPath,
            oldValue: null,
            newValue: JSON.stringify(d.value),
            changedAt: now,
          });
        } else if (d.type === 'REMOVE') {
          changes.push({
            mediaType,
            mediaId,
            fieldPath,
            oldValue: JSON.stringify(d.oldValue),
            newValue: null,
            changedAt: now,
          });
        }
      }

      // Merge: preserve non-hydrated fields from previous snapshot
      const mergedData: Record<string, unknown> = { ...previousData };
      for (const [key, value] of Object.entries(flatData)) {
        const service = key.split('.')[0];
        if (hydratedServices.has(service)) {
          mergedData[key] = value;
        }
      }
      // Remove keys that were in previous but not in current for hydrated services
      for (const key of Object.keys(mergedData)) {
        const service = key.split('.')[0];
        if (hydratedServices.has(service) && !(key in flatData)) {
          delete mergedData[key];
        }
      }

      const mergedJson = JSON.stringify(
        mergedData,
        Object.keys(mergedData).sort(),
      );
      const mergedHash = String(Bun.hash(mergedJson));

      upserts.push({
        mediaType,
        mediaId,
        title: item.title,
        data: mergedJson,
        dataHash: mergedHash,
        firstSeenAt: now,
        lastSeenAt: now,
        isNew: false,
      });
    }

    // Step 4: Execute all writes in a single transaction
    await db.transaction(async tx => {
      // Upsert media items in chunks
      for (const batch of chunk(upserts, MEDIA_ITEMS_CHUNK_SIZE)) {
        await tx
          .insert(mediaItems)
          .values(
            batch.map(u => ({
              mediaType: u.mediaType,
              mediaId: u.mediaId,
              title: u.title,
              data: u.data,
              dataHash: u.dataHash,
              firstSeenAt: u.firstSeenAt,
              lastSeenAt: u.lastSeenAt,
              missedEvaluations: 0,
            })),
          )
          .onConflictDoUpdate({
            target: [mediaItems.mediaType, mediaItems.mediaId],
            set: {
              title: sql`excluded.title`,
              data: sql`excluded.data`,
              dataHash: sql`excluded.data_hash`,
              lastSeenAt: sql`excluded.last_seen_at`,
              missedEvaluations: sql`0`,
            },
          });
      }

      // Insert field changes in chunks
      for (const batch of chunk(changes, FIELD_CHANGES_CHUNK_SIZE)) {
        await tx.insert(fieldChanges).values(
          batch.map(c => ({
            mediaType: c.mediaType,
            mediaId: c.mediaId,
            fieldPath: c.fieldPath,
            oldValue: c.oldValue,
            newValue: c.newValue,
            changedAt: c.changedAt,
          })),
        );
      }

      // Increment missed_evaluations for items not seen this cycle
      await this.incrementMissedEvaluations(tx, currentIds);
    });

    this.logger.log(
      `Snapshot complete: ${upserts.filter(u => u.isNew).length} new, ` +
        `${upserts.filter(u => !u.isNew).length} updated, ` +
        `${changes.length} field changes recorded`,
    );

    // Step 5: Cleanup (outside transaction for smaller lock windows)
    await this.cleanupOrphans();
  }

  /** Extract the media ID used as the composite key. */
  private getMediaId(item: UnifiedMedia): string {
    if (item.type === 'movie') {
      return String(item.tmdb_id);
    }
    return `${item.tvdb_id}:${item.sonarr.season.season_number}`;
  }

  /**
   * Flatten a unified model to a dotted-key map using the field registry.
   * Only includes fields defined in the registry for this target type.
   */
  private flattenItem(
    item: UnifiedMedia,
    hydratedServices: Set<string>,
  ): Record<string, unknown> {
    const target = item.type === 'movie' ? 'radarr' : 'sonarr';
    const registry = fieldRegistry[target];
    const flat: Record<string, unknown> = {};

    for (const fieldPath of Object.keys(registry)) {
      const service = fieldPath.split('.')[0];
      if (!hydratedServices.has(service)) continue;

      const { value, resolved } = resolveField(item, fieldPath);
      if (resolved) {
        flat[fieldPath] = value;
      }
    }

    return flat;
  }

  /** Filter a flat data map to only include keys belonging to given services. */
  private filterByServices(
    data: Record<string, unknown>,
    services: Set<string>,
  ): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const service = key.split('.')[0];
      if (services.has(service)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  /**
   * Sort array values in a flat data map to avoid phantom diffs
   * from API responses returning arrays in different orders.
   */
  private sortArrayValues(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        sorted[key] = [...value].sort();
      } else {
        sorted[key] = value;
      }
    }
    return sorted;
  }

  /** Load all existing snapshots into a Map for batch comparison. */
  private loadAllSnapshots(): Map<string, SnapshotRow> {
    const db = this.getDb();
    const rows = db.select().from(mediaItems).all();
    const map = new Map<string, SnapshotRow>();
    for (const row of rows) {
      map.set(`${row.mediaType}:${row.mediaId}`, row);
    }
    return map;
  }

  /** Increment missed_evaluations for all items not in the current set. */
  private async incrementMissedEvaluations(
    tx: BunSQLiteDatabase<typeof schema>,
    currentIds: Set<string>,
  ): Promise<void> {
    const allRows = tx
      .select({
        mediaType: mediaItems.mediaType,
        mediaId: mediaItems.mediaId,
      })
      .from(mediaItems)
      .all();

    for (const row of allRows) {
      const key = `${row.mediaType}:${row.mediaId}`;
      if (!currentIds.has(key)) {
        await tx
          .update(mediaItems)
          .set({
            missedEvaluations: sql`${mediaItems.missedEvaluations} + 1`,
          })
          .where(
            sql`${mediaItems.mediaType} = ${row.mediaType} AND ${mediaItems.mediaId} = ${row.mediaId}`,
          );
      }
    }
  }

  /** Delete snapshots that have been missing for more than the grace period. */
  private async cleanupOrphans(): Promise<void> {
    const db = this.getDb();
    const deleted = await db
      .delete(mediaItems)
      .where(gt(mediaItems.missedEvaluations, ORPHAN_GRACE_EVALUATIONS));

    if (deleted.changes > 0) {
      this.logger.log(`Cleaned up ${deleted.changes} orphan snapshots`);
    }
  }
}
