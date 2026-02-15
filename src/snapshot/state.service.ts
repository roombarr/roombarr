import type { Database } from 'bun:sqlite';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { StateData, UnifiedMedia, UnifiedMovie } from '../shared/types.js';

interface FieldChangeRow {
  new_value: string | null;
  changed_at: string;
}

interface SnapshotDataRow {
  data: string;
}

/**
 * Computes temporal state fields from the field_changes history.
 * These enriched fields enable time-based lifecycle rules
 * like "days since this movie fell off all import lists."
 */
@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);
  private db!: Database;

  constructor(private readonly databaseService: DatabaseService) {}

  private getDb() {
    if (!this.db) {
      this.db = this.databaseService.getDatabase();
    }
    return this.db;
  }

  /**
   * Enrich unified media items with computed temporal state.
   * Only movies get state data (state fields are Radarr-only).
   * Returns the same items with `state` populated.
   */
  enrich(items: UnifiedMedia[]): UnifiedMedia[] {
    const db = this.getDb();

    // Check if any snapshots exist — if not, this is the first evaluation
    const snapshotCount =
      db
        .query<{ count: number }, []>(
          'SELECT COUNT(*) as count FROM media_snapshots',
        )
        .get()?.count ?? 0;

    if (snapshotCount === 0) {
      this.logger.debug(
        'No snapshots exist yet (first evaluation), skipping state enrichment',
      );
      return items;
    }

    return items.map(item => {
      if (item.type !== 'movie') return item;
      return { ...item, state: this.computeMovieState(item) };
    });
  }

  /** Compute all temporal state fields for a single movie. */
  private computeMovieState(movie: UnifiedMovie): StateData | null {
    const db = this.getDb();
    const mediaType = 'movie';
    const mediaId = String(movie.tmdb_id);

    // Check if this movie has a snapshot (i.e., has been seen before)
    const snapshot = db
      .query<SnapshotDataRow, [string, string]>(
        'SELECT data FROM media_snapshots WHERE media_type = ? AND media_id = ?',
      )
      .get(mediaType, mediaId);

    if (!snapshot) {
      // Movie hasn't been snapshotted yet — no state
      return null;
    }

    return {
      days_off_import_list: this.computeDaysOffImportList(
        mediaType,
        mediaId,
        movie.radarr.on_import_list,
      ),
      ever_on_import_list: this.computeEverOnImportList(
        mediaType,
        mediaId,
        movie.radarr.on_import_list,
      ),
    };
  }

  /**
   * Compute days since `radarr.on_import_list` changed to `false`.
   *
   * - If currently on a list: return null (safe)
   * - If currently off: find most recent change to false, compute elapsed days
   * - If no change history exists: return null (never observed on a list)
   */
  private computeDaysOffImportList(
    mediaType: string,
    mediaId: string,
    currentlyOnList: boolean,
  ): number | null {
    if (currentlyOnList) return null;

    const db = this.getDb();
    const row = db
      .query<FieldChangeRow, [string, string, string, string]>(
        `SELECT new_value, changed_at FROM field_changes
         WHERE media_type = ? AND media_id = ? AND field_path = ?
           AND new_value = ?
         ORDER BY changed_at DESC
         LIMIT 1`,
      )
      .get(mediaType, mediaId, 'radarr.on_import_list', 'false');

    if (!row) return null;

    const changedAt = new Date(row.changed_at);
    const now = new Date();
    const diffMs = now.getTime() - changedAt.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Check if the movie was ever observed on an import list.
   * True if any field_changes row shows on_import_list was or became true,
   * OR if the movie is currently on a list.
   *
   * We check both old_value and new_value because the first observation
   * skips field_changes generation — if a movie starts on a list and then
   * falls off, the only field_change has old_value='true', new_value='false'.
   */
  private computeEverOnImportList(
    mediaType: string,
    mediaId: string,
    currentlyOnList: boolean,
  ): boolean {
    if (currentlyOnList) return true;

    const db = this.getDb();
    const row = db
      .query<{ id: number }, [string, string, string, string, string]>(
        `SELECT id FROM field_changes
         WHERE media_type = ? AND media_id = ? AND field_path = ?
           AND (new_value = ? OR old_value = ?)
         LIMIT 1`,
      )
      .get(mediaType, mediaId, 'radarr.on_import_list', 'true', 'true');

    return row !== null;
  }
}
