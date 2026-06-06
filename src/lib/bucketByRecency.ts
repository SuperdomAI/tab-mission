import type { EnrichedTab } from "../types/index";

export type BucketKey = "now" | "earlier" | "gettingOld" | "forgotten";

export interface Bucket {
  key: BucketKey;
  label: string;
  tabs: EnrichedTab[];
}

const NOW_MS = 30 * 60_000; // < 30 min
const EARLIER_MS = 6 * 60 * 60_000; // < 6 h
const DAY_MS = 24 * 60 * 60_000; // < 24 h  (>= 24h => forgotten)

const LABELS: Record<BucketKey, string> = {
  now: "Now",
  earlier: "Earlier today",
  gettingOld: "Getting old",
  forgotten: "Forgotten",
};

const ORDER: BucketKey[] = ["now", "earlier", "gettingOld", "forgotten"];

/**
 * Reference time for recency = last activity, falling back to when the tab
 * was opened. This fallback is the safety guarantee: a freshly opened or
 * session-restored tab (lastActiveAt === null, visitCount === 0) has a recent
 * `openedAt`, so it lands in "now"/"earlier" and is NEVER swept as forgotten.
 */
function refTime(tab: EnrichedTab): number {
  return tab.lastActiveAt ?? tab.openedAt;
}

export function bucketOf(tab: EnrichedTab, now: number = Date.now()): BucketKey {
  const age = now - refTime(tab);
  if (age < NOW_MS) return "now";
  if (age < EARLIER_MS) return "earlier";
  if (age < DAY_MS) return "gettingOld";
  return "forgotten";
}

/** Ordered, non-empty buckets for the Timeline view. */
export function bucketByRecency(
  tabs: EnrichedTab[],
  now: number = Date.now(),
): Bucket[] {
  const map = new Map<BucketKey, EnrichedTab[]>();
  for (const tab of tabs) {
    const key = bucketOf(tab, now);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tab);
  }
  // newest first within a bucket
  for (const list of map.values()) {
    list.sort((a, b) => refTime(b) - refTime(a));
  }
  return ORDER.filter((k) => map.has(k)).map((key) => ({
    key,
    label: LABELS[key],
    tabs: map.get(key)!,
  }));
}

/**
 * Tabs that "Clear forgotten" is allowed to close. CRITICAL safety rules:
 *  - must be in the "forgotten" bucket (>= 24h since last touch / open), and
 *  - never pinned.
 * Because forgotten uses refTime (openedAt fallback), recently opened or
 * session-restored never-visited tabs are excluded automatically.
 */
export function clearableForgotten(
  tabs: EnrichedTab[],
  now: number = Date.now(),
): EnrichedTab[] {
  return tabs.filter((t) => !t.isPinned && bucketOf(t, now) === "forgotten");
}
