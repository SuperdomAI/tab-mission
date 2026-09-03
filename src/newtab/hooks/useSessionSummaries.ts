import { useCallback, useEffect, useState } from "react";
import {
  AI_SESSION_SUMMARIES_KEY,
  SessionSummaryCache,
  type SessionSummariesMap,
  type SessionSummaryEntry,
} from "../../lib/ai/sessionMemory";

/**
 * Mirrors the `aiSessionSummaries` storage key (F4 session memory) into React
 * state. Written by BOTH the React layer (`persistSession` → `summarizeSession`)
 * and the service worker (window auto-save) — the `aiTriagePlan` dual-owner
 * pattern, cohered through the same `SessionSummaryCache`.
 */
export function useSessionSummaries() {
  const [cache, setCache] = useState<SessionSummaryCache>(SessionSummaryCache.empty);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(AI_SESSION_SUMMARIES_KEY).then((result) => {
      if (alive) {
        setCache(SessionSummaryCache.fromStorage(result[AI_SESSION_SUMMARIES_KEY]));
      }
    });
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local" && changes[AI_SESSION_SUMMARIES_KEY] !== undefined) {
        setCache(
          SessionSummaryCache.fromStorage(changes[AI_SESSION_SUMMARIES_KEY].newValue),
        );
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /** Fresh entry for a session id (30-day TTL + model match), or undefined. */
  const get = useCallback(
    (id: string, model: string, now: number = Date.now()) =>
      cache.get(id, model, now),
    [cache],
  );

  /** Raw entry for a session id (display; freshness not enforced). */
  const entry = useCallback(
    (id: string): SessionSummaryEntry | undefined => cache.entry(id),
    [cache],
  );

  /** The raw coerced map (CommandPalette session search merges over it). */
  const summaries: SessionSummariesMap = cache.map();

  return { summaries, get, entry };
}