import type { EnrichedTab } from "../types/index";

export type TabStatus =
  | "recent"
  | "stale"
  | "unvisited"
  | "hibernated"
  | "normal";

export const RECENT_MS = 30 * 60_000; // 30 min
export const STALE_MS = 2 * 60 * 60_000; // 2 h

export interface StatusMeta {
  /** CSS custom-property name carrying the status color (see index.css). */
  cssVar: string;
  label: string;
}

export const STATUS_META: Record<TabStatus, StatusMeta> = {
  recent: { cssVar: "--status-recent", label: "Active" },
  stale: { cssVar: "--status-stale", label: "Stale" },
  unvisited: { cssVar: "--status-unvisited", label: "Never visited" },
  hibernated: { cssVar: "--status-hibernated", label: "Asleep" },
  normal: { cssVar: "--text-faint", label: "" },
};

/**
 * Single source of truth for a tab's at-a-glance status. Precedence matches
 * the original TabCard logic (never-visited wins, then hibernated, then
 * recency). `now` is injectable for deterministic tests.
 *
 *   visitCount === 0            -> unvisited
 *   isHibernated               -> hibernated
 *   lastActiveAt < 30m ago     -> recent
 *   lastActiveAt > 2h ago      -> stale
 *   otherwise                  -> normal
 */
export function tabStatus(tab: EnrichedTab, now: number = Date.now()): TabStatus {
  if (tab.visitCount === 0) return "unvisited";
  if (tab.isHibernated) return "hibernated";
  if (tab.lastActiveAt !== null) {
    const age = now - tab.lastActiveAt;
    if (age < RECENT_MS) return "recent";
    if (age > STALE_MS) return "stale";
  }
  return "normal";
}
