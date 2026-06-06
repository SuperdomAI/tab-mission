import type { EnrichedTab, AppSettings } from "../types/index";

const UNVISITED_MS = 30 * 60_000; // opened > 30 min ago, never visited

/**
 * Bulk-action selectors. EVERY selector excludes pinned tabs — closing a
 * user's pinned tab is a trust-killer (this was a bug in the old BulkActions).
 * All take `now` for deterministic tests.
 */

/** Duplicate URLs to close, keeping the most-recently-active tab per URL. */
export function selectDuplicates(tabs: EnrichedTab[]): EnrichedTab[] {
  const best = new Map<string, EnrichedTab>(); // url -> keeper
  const closable: EnrichedTab[] = [];
  // Process so the keeper is the most recently active.
  const ordered = [...tabs].sort(
    (a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
  );
  for (const tab of ordered) {
    if (tab.isPinned) continue; // never close pinned
    const keeper = best.get(tab.url);
    if (!keeper) best.set(tab.url, tab);
    else closable.push(tab);
  }
  return closable;
}

export function selectUnvisited(
  tabs: EnrichedTab[],
  now: number = Date.now(),
): EnrichedTab[] {
  return tabs.filter(
    (t) =>
      !t.isPinned && t.visitCount === 0 && t.openedAt < now - UNVISITED_MS,
  );
}

export function selectZombies(
  tabs: EnrichedTab[],
  settings: AppSettings,
  now: number = Date.now(),
): EnrichedTab[] {
  const threshold = now - settings.zombieThresholdHours * 3_600_000;
  return tabs.filter(
    (t) => !t.isPinned && (t.lastActiveAt === null || t.lastActiveAt < threshold),
  );
}
