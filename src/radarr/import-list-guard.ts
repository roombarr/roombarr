/**
 * The import-list collapse guard's decision logic.
 *
 * A list's trusted membership is what the previous run recorded in the
 * snapshot: while a list is held, its held membership is reported, so the
 * snapshot keeps recording those movies on it across runs and restarts.
 *
 * @see docs/adr/0003-import-list-collapse-holds-membership.md
 */

import type { ConfiguredImportList } from './radarr.types';

export const HOLD_REASONS = ['empty', 'shrunk'] as const;

/**
 * Why a list is held. An `empty` list is held until acknowledged; a `shrunk`
 * one is also accepted once its size has been stable long enough.
 */
export type HoldReason = (typeof HOLD_REASONS)[number];

/** A list whose collapse is being held, as persisted between runs. */
export interface ImportListHold {
  listId: number;
  reason: HoldReason;
  /** Library movies the list had before it collapsed. */
  trustedSize: number;
  /** Library movies the list reported this run. */
  currentSize: number;
  /** When the current hold began. */
  heldSince: string;
  /** Since when the list has reported `currentSize` on every run. */
  sizeSince: string;
  /** The user acknowledged the collapse; the next run releases the list. */
  acknowledged: boolean;
}

/** What the guard decided about one list this run, for logging. */
export type ImportListGuardEvent =
  | { kind: 'held'; list: ConfiguredImportList; hold: ImportListHold }
  | {
      kind: 'accepted';
      list: ConfiguredImportList;
      trustedSize: number;
      currentSize: number;
    }
  | {
      kind: 'released';
      list: ConfiguredImportList;
      trustedSize: number;
      currentSize: number;
    };

export interface GuardImportListInput {
  /** TMDB IDs of every movie in the Radarr library this run. */
  library: number[];
  /** Each library movie's list IDs as Radarr reported them this run. */
  reported: Map<number, number[]>;
  /** Each movie's list IDs as last recorded in the snapshot. */
  recorded: Map<number, number[]>;
  /** The import lists configured in Radarr. */
  lists: ConfiguredImportList[];
  /** Holds persisted by the previous run. */
  holds: ImportListHold[];
  /** Shrinking by more than this fraction of the trusted size is a collapse. */
  threshold: number;
  now: Date;
}

export interface GuardImportListResult {
  /** Each library movie's effective list IDs, held lists included. */
  membership: Map<number, number[]>;
  /** Holds to persist for the next run. */
  holds: ImportListHold[];
  events: ImportListGuardEvent[];
}

/** Hold the membership of every list that collapsed since the last run. */
export function guardImportListMembership(
  input: GuardImportListInput,
): GuardImportListResult {
  const decisions = input.lists
    .filter(list => list.enabled)
    .map(list => decideList(list, input));

  const heldListIds = new Set(
    decisions.flatMap(d => (d.holding && d.hold ? [d.hold.listId] : [])),
  );

  return {
    membership: effectiveMembership(input, heldListIds),
    holds: decisions.flatMap(d => (d.hold ? [d.hold] : [])),
    events: decisions.flatMap(d => (d.event ? [d.event] : [])),
  };
}

/**
 * `hold` is what to persist; `holding` is whether this run holds the list's
 * membership. A released or accepted list keeps its stored hold until the
 * snapshot records its movies leaving: if this run fails before the snapshot
 * is written, the next run sees the same collapse and releases it again
 * rather than starting a new hold.
 */
interface ListDecision {
  hold: ImportListHold | null;
  holding: boolean;
  event: ImportListGuardEvent | null;
}

const TRUSTED: ListDecision = { hold: null, holding: false, event: null };

function decideList(
  list: ConfiguredImportList,
  input: GuardImportListInput,
): ListDecision {
  const trustedSize = countOnList({
    listId: list.id,
    library: input.library,
    index: input.recorded,
  });
  const currentSize = countOnList({
    listId: list.id,
    library: input.library,
    index: input.reported,
  });

  if (!isCollapsed({ trustedSize, currentSize, threshold: input.threshold })) {
    return TRUSTED;
  }

  const previous = input.holds.find(hold => hold.listId === list.id);
  const now = input.now.toISOString();
  const hold: ImportListHold = {
    listId: list.id,
    reason: currentSize === 0 ? 'empty' : 'shrunk',
    trustedSize,
    currentSize,
    heldSince: previous?.heldSince ?? now,
    sizeSince: previous?.currentSize === currentSize ? previous.sizeSince : now,
    acknowledged: previous?.acknowledged ?? false,
  };

  if (hold.acknowledged) {
    return {
      hold,
      holding: false,
      event: { kind: 'released', list, trustedSize, currentSize },
    };
  }

  if (isShrinkSettled(hold, input.now)) {
    return {
      hold,
      holding: false,
      event: { kind: 'accepted', list, trustedSize, currentSize },
    };
  }

  return { hold, holding: true, event: { kind: 'held', list, hold } };
}

/** How long a shrunk list must report the same size before it's accepted. */
export const SHRINK_ACCEPTANCE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A shrunk list that reported the same size on every run for long enough was
 * shrunk on purpose. An empty list never settles: an outage can be permanent.
 */
function isShrinkSettled(hold: ImportListHold, now: Date): boolean {
  if (hold.reason === 'empty') return false;
  const stableFor = now.getTime() - new Date(hold.sizeSince).getTime();
  return stableFor >= SHRINK_ACCEPTANCE_MS;
}

/**
 * A list collapsed when it had movies to protect and now reports none, or
 * shrank by more than the threshold. A list with nothing recorded on it is
 * new to Roombarr, so whatever it reports is trusted.
 */
function isCollapsed({
  trustedSize,
  currentSize,
  threshold,
}: {
  trustedSize: number;
  currentSize: number;
  threshold: number;
}): boolean {
  if (trustedSize === 0) return false;
  if (currentSize === 0) return true;
  return currentSize < trustedSize * (1 - threshold);
}

/** How many library movies a membership index places on a list. */
function countOnList({
  listId,
  library,
  index,
}: {
  listId: number;
  library: number[];
  index: Map<number, number[]>;
}): number {
  return library.filter(tmdbId => index.get(tmdbId)?.includes(listId)).length;
}

/** Reported membership plus recorded membership of held lists. */
function effectiveMembership(
  { library, reported, recorded }: GuardImportListInput,
  heldListIds: Set<number>,
): Map<number, number[]> {
  const membership = new Map<number, number[]>();
  for (const tmdbId of library) {
    const held = (recorded.get(tmdbId) ?? []).filter(id => heldListIds.has(id));
    const listIds = [...new Set([...(reported.get(tmdbId) ?? []), ...held])];
    if (listIds.length > 0)
      membership.set(
        tmdbId,
        listIds.sort((a, b) => a - b),
      );
  }
  return membership;
}
