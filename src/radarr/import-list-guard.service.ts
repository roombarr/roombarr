import { Injectable, Logger } from '@nestjs/common';
import { eq, notInArray } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { DatabaseService } from '../database/database.service';
import type * as schema from '../database/schema';
import { importListHolds } from '../database/schema';
import { SnapshotService } from '../snapshot/snapshot.service';
import {
  guardImportListMembership,
  HOLD_REASONS,
  type ImportListGuardEvent,
  type ImportListHold,
  SHRINK_ACCEPTANCE_MS,
} from './import-list-guard';
import type { ConfiguredImportList } from './radarr.types';

/** A stored hold row, validated on the way out of the database. */
const holdRowSchema = z.object({
  listId: z.number(),
  reason: z.enum(HOLD_REASONS),
  trustedSize: z.number(),
  currentSize: z.number(),
  heldSince: z.string(),
  sizeSince: z.string(),
  acknowledgedAt: z.string().nullable(),
});

/** The outcome of acknowledging a list's collapse. */
export type AcknowledgeResult = 'acknowledged' | 'not_held';

/**
 * Holds the membership of Radarr import lists that collapse, persisting each
 * held list between runs and taking the user's acknowledgements.
 *
 * @see docs/adr/0003-import-list-collapse-holds-membership.md
 */
@Injectable()
export class ImportListGuardService {
  private readonly logger = new Logger(ImportListGuardService.name);
  private db!: BunSQLiteDatabase<typeof schema>;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly snapshotService: SnapshotService,
  ) {}

  private getDb() {
    if (!this.db) {
      this.db = this.databaseService.getDrizzle();
    }
    return this.db;
  }

  /**
   * Each library movie's import-list IDs for this run, keyed by TMDB ID.
   *
   * With the guard on, a collapsed list's recorded membership stands in for
   * what Radarr reported, and the run's holds are persisted. With it off,
   * Radarr's report is returned as is and any holds are dropped.
   */
  resolveMembership({
    library,
    reported,
    lists,
  }: {
    library: number[];
    reported: Map<number, number[]>;
    lists: ConfiguredImportList[];
  }): Map<number, number[]> {
    const { hold_collapsed_import_lists, import_list_collapse_threshold } =
      this.configService.getConfig().safety;

    if (!hold_collapsed_import_lists) {
      this.saveHolds([]);
      return reported;
    }

    const result = guardImportListMembership({
      library,
      reported,
      recorded: this.snapshotService.lastRecordedImportListMembership(),
      lists,
      holds: this.loadHolds(),
      threshold: import_list_collapse_threshold,
      now: new Date(),
    });

    this.saveHolds(result.holds);
    for (const event of result.events) this.logEvent(event);
    return result.membership;
  }

  /**
   * Acknowledge a held list's collapse so the next run releases it. The
   * acknowledgement is consumed by that run: a later collapse is held again.
   */
  acknowledge(listId: number): AcknowledgeResult {
    const row = this.getDb()
      .update(importListHolds)
      .set({ acknowledgedAt: new Date().toISOString() })
      .where(eq(importListHolds.listId, listId))
      .returning({ listId: importListHolds.listId })
      .get();

    if (!row) return 'not_held';

    this.logger.log(
      `Import list ${listId} acknowledged; the next evaluation releases its held movies`,
    );
    return 'acknowledged';
  }

  private loadHolds(): ImportListHold[] {
    return this.getDb()
      .select()
      .from(importListHolds)
      .all()
      .map(row => toHold(row));
  }

  /**
   * Replace the stored holds with this run's. An acknowledgement that arrived
   * while the run was in progress is kept for the next run.
   */
  private saveHolds(holds: ImportListHold[]): void {
    const heldIds = holds.map(hold => hold.listId);

    this.getDb().transaction(tx => {
      tx.delete(importListHolds)
        .where(notInArray(importListHolds.listId, heldIds))
        .run();

      // `acknowledged` is left out so the update never clears an
      // acknowledgement stored after this run loaded its holds.
      for (const { listId, acknowledged: _, ...progress } of holds) {
        tx.insert(importListHolds)
          .values({ listId, ...progress })
          .onConflictDoUpdate({ target: importListHolds.listId, set: progress })
          .run();
      }
    });
  }

  private logEvent(event: ImportListGuardEvent): void {
    const label = `Import list "${event.list.name}" (id ${event.list.id})`;

    switch (event.kind) {
      case 'held':
        this.logger.warn(`${label} ${describeHold(event.hold)}`);
        return;
      case 'accepted':
        this.logger.log(
          `${label} accepted at ${event.currentSize} movies (was ${event.trustedSize}) after reporting that size for ${SHRINK_ACCEPTANCE_DAYS} days; movies no longer on it now leave it`,
        );
        return;
      case 'released':
        this.logger.log(
          `${label} released after acknowledgement at ${event.currentSize} movies (was ${event.trustedSize}); movies no longer on it now leave it`,
        );
        return;
    }
  }
}

const SHRINK_ACCEPTANCE_DAYS = SHRINK_ACCEPTANCE_MS / (24 * 60 * 60 * 1000);

/** Why a list is held and how it gets released, for the per-run warning. */
function describeHold(hold: ImportListHold): string {
  const acknowledge = `curl -X POST <roombarr-url>/import-lists/${hold.listId}/acknowledge`;
  const held = `reported ${hold.currentSize} of its ${hold.trustedSize} movies; holding its last trusted membership (held since ${hold.heldSince})`;

  if (hold.reason === 'empty') {
    return `${held}. An empty list is never accepted automatically. If it really is empty, acknowledge it: ${acknowledge}`;
  }

  return `${held}, as it shrank by more than safety.import_list_collapse_threshold. It is accepted once it reports ${hold.currentSize} movies on every run for ${SHRINK_ACCEPTANCE_DAYS} days (since ${hold.sizeSince}), or acknowledge it now: ${acknowledge}`;
}

function toHold(row: unknown): ImportListHold {
  const { acknowledgedAt, ...hold } = holdRowSchema.parse(row);
  return { ...hold, acknowledged: acknowledgedAt !== null };
}
