import type { Database } from 'bun:sqlite';
import { Injectable, Logger } from '@nestjs/common';
import diff from 'microdiff';
import { fieldRegistry } from '../config/field-registry.js';
import { DatabaseService } from '../database/database.service.js';
import { resolveField } from '../rules/field-resolver.js';
import type { UnifiedMedia } from '../shared/types.js';

/** Row shape for media_snapshots table. */
interface SnapshotRow {
  media_type: string;
  media_id: string;
  title: string;
  data: string;
  data_hash: string;
  missed_evaluations: number;
}

/** How many evaluations an item can be absent before its snapshot is purged. */
const ORPHAN_GRACE_EVALUATIONS = 7;

/** Default retention for field_changes rows (days). */
const CHANGE_RETENTION_DAYS = 90;

/** Batch size for retention cleanup deletes. */
const RETENTION_CLEANUP_BATCH = 1000;

/**
 * Persists unified media snapshots to SQLite and tracks
 * field-level changes in an append-only log.
 *
 * Runs after hydration and before rule evaluation each cycle.
 */
@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);
  private db!: Database;

  constructor(private readonly databaseService: DatabaseService) {}

  /** Late-bind to avoid accessing DB before module init. */
  private getDb() {
    if (!this.db) {
      this.db = this.databaseService.getDatabase();
    }
    return this.db;
  }

  /**
   * Snapshot all unified media items, detect field changes,
   * and clean up orphans/expired changes.
   *
   * @param items - The current evaluation's hydrated unified models
   * @param hydratedServices - Set of service prefixes that were actually fetched
   *   this cycle (e.g., {'radarr', 'jellyfin'}). Only fields belonging to
   *   these services are diffed/overwritten.
   */
  snapshot(items: UnifiedMedia[], hydratedServices: Set<string>): void {
    const db = this.getDb();

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
      isNew: boolean;
    }> = [];

    const changes: Array<{
      mediaType: string;
      mediaId: string;
      fieldPath: string;
      oldValue: string | null;
      newValue: string | null;
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
          isNew: true,
        });
        continue;
      }

      // Content hash skip — if unchanged, just reset missed_evaluations
      if (existing.data_hash === dataHash) {
        if (existing.missed_evaluations > 0) {
          upserts.push({
            mediaType,
            mediaId,
            title: item.title,
            data: existing.data,
            dataHash: existing.data_hash,
            isNew: false,
          });
        }
        continue;
      }

      // Diff against previous snapshot (only hydrated service fields)
      const previousData = JSON.parse(existing.data) as Record<string, unknown>;
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
          });
        } else if (d.type === 'CREATE') {
          changes.push({
            mediaType,
            mediaId,
            fieldPath,
            oldValue: null,
            newValue: JSON.stringify(d.value),
          });
        } else if (d.type === 'REMOVE') {
          changes.push({
            mediaType,
            mediaId,
            fieldPath,
            oldValue: JSON.stringify(d.oldValue),
            newValue: null,
          });
        }
      }

      // Merge: preserve non-hydrated fields from previous snapshot
      const mergedData = { ...previousData };
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
        isNew: false,
      });
    }

    // Step 4: Execute all writes in a single transaction
    const runTransaction = db.transaction(() => {
      const upsertStmt = db.query(`
        INSERT INTO media_snapshots (media_type, media_id, title, data, data_hash, missed_evaluations)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(media_type, media_id) DO UPDATE SET
          title = excluded.title,
          data = excluded.data,
          data_hash = excluded.data_hash,
          last_updated_at = datetime('now'),
          missed_evaluations = 0
      `);

      const changeStmt = db.query(`
        INSERT INTO field_changes (media_type, media_id, field_path, old_value, new_value)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const u of upserts) {
        upsertStmt.run(u.mediaType, u.mediaId, u.title, u.data, u.dataHash);
      }

      for (const c of changes) {
        changeStmt.run(
          c.mediaType,
          c.mediaId,
          c.fieldPath,
          c.oldValue,
          c.newValue,
        );
      }

      // Increment missed_evaluations for items not seen this cycle
      this.incrementMissedEvaluations(currentIds);
    });

    runTransaction();

    this.logger.log(
      `Snapshot complete: ${upserts.filter(u => u.isNew).length} new, ` +
        `${upserts.filter(u => !u.isNew).length} updated, ` +
        `${changes.length} field changes recorded`,
    );

    // Step 5: Cleanup (outside transaction for smaller lock windows)
    this.cleanupOrphans();
    this.cleanupExpiredChanges();
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
    const rows = db
      .query<SnapshotRow, []>('SELECT * FROM media_snapshots')
      .all();
    const map = new Map<string, SnapshotRow>();
    for (const row of rows) {
      map.set(`${row.media_type}:${row.media_id}`, row);
    }
    return map;
  }

  /** Increment missed_evaluations for all items not in the current set. */
  private incrementMissedEvaluations(currentIds: Set<string>): void {
    const db = this.getDb();
    const allRows = db
      .query<{ media_type: string; media_id: string }, []>(
        'SELECT media_type, media_id FROM media_snapshots',
      )
      .all();

    const stmt = db.query(
      'UPDATE media_snapshots SET missed_evaluations = missed_evaluations + 1 WHERE media_type = ? AND media_id = ?',
    );

    for (const row of allRows) {
      const key = `${row.media_type}:${row.media_id}`;
      if (!currentIds.has(key)) {
        stmt.run(row.media_type, row.media_id);
      }
    }
  }

  /** Delete snapshots that have been missing for more than the grace period. */
  private cleanupOrphans(): void {
    const db = this.getDb();
    const { changes } = db
      .query('DELETE FROM media_snapshots WHERE missed_evaluations > ?')
      .run(ORPHAN_GRACE_EVALUATIONS);

    if (changes > 0) {
      this.logger.log(`Cleaned up ${changes} orphan snapshots`);
    }
  }

  /**
   * Delete expired field_changes rows, but always preserve
   * the most recent entry per (media_id, field_path) regardless of age.
   */
  private cleanupExpiredChanges(): void {
    const db = this.getDb();
    const { changes } = db
      .query(
        `DELETE FROM field_changes
         WHERE changed_at < datetime('now', '-${CHANGE_RETENTION_DAYS} days')
           AND id NOT IN (
             SELECT MAX(id) FROM field_changes
             GROUP BY media_type, media_id, field_path
           )
         LIMIT ?`,
      )
      .run(RETENTION_CLEANUP_BATCH);

    if (changes > 0) {
      this.logger.log(`Cleaned up ${changes} expired field change records`);
    }
  }
}
