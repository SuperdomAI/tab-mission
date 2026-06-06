import Fuse from "fuse.js";
import type { EnrichedTab } from "../types/index";

export interface RelevanceSplit {
  keep: EnrichedTab[];
  stash: EnrichedTab[];
}

/**
 * Heuristic "goal -> relevant tabs" — the hero feature, NO AI required.
 * Scores each open tab against the goal with Fuse (title/url/domain) and splits
 * keep vs set-aside. Always presented as a PROPOSAL; never auto-applied.
 *
 * - Pinned tabs are always kept (never set aside).
 * - Empty goal keeps everything (nothing to set aside).
 * - `strictness` 0..1: higher = keep fewer (tighter match). The LLM layer can
 *   refine this split later, but this is the offline default for all users.
 */
export function scoreTabs(
  tabs: EnrichedTab[],
  goal: string,
  strictness = 0.5,
): RelevanceSplit {
  if (!goal.trim()) return { keep: [...tabs], stash: [] };

  const pinned = tabs.filter((t) => t.isPinned);
  const rest = tabs.filter((t) => !t.isPinned);

  const fuse = new Fuse(rest, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "url", weight: 0.2 },
      { name: "domain", weight: 0.2 },
    ],
    includeScore: true,
    threshold: 1, // include all; we apply our own cutoff below
    ignoreLocation: true,
  });

  // Score each tab by its BEST match across the goal's words — a tab relevant
  // to any meaningful goal term should be kept, not only an all-words match.
  const words = goal.split(/\s+/).filter((w) => w.length >= 2);
  const queries = words.length > 0 ? words : [goal];
  const scoreById = new Map<number, number>();
  for (const q of queries) {
    for (const r of fuse.search(q)) {
      const prev = scoreById.get(r.item.id) ?? 1;
      scoreById.set(r.item.id, Math.min(prev, r.score ?? 1));
    }
  }

  // Lower Fuse score = better match. strictness 0 -> 0.75 cutoff, 1 -> 0.15.
  const cutoff = 0.6 * (1 - strictness) + 0.15;

  const keepRest = rest.filter((t) => (scoreById.get(t.id) ?? 1) <= cutoff);
  const keepIds = new Set(keepRest.map((t) => t.id));
  const stash = rest.filter((t) => !keepIds.has(t.id));

  return { keep: [...pinned, ...keepRest], stash };
}
