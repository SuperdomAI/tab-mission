import { useCallback, useEffect, useState } from "react";
import { AIReportCache, AI_REPORTS_KEY, type ReportTask } from "../../lib/ai/reports";
import type { CacheEntry } from "../../lib/ai/cache";

/**
 * Mirrors the `aiReports` storage key (daily debrief + weekly coach reports)
 * into React state. The service worker never writes this key — reports are a
 * derived, regenerable UI-side cache (the same precedent as `workspaces`).
 */
export function useAIReports() {
  const [cache, setCache] = useState<AIReportCache>(AIReportCache.empty);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(AI_REPORTS_KEY).then((result) => {
      if (alive) setCache(AIReportCache.fromStorage(result[AI_REPORTS_KEY]));
    });
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local" && changes[AI_REPORTS_KEY]?.newValue !== undefined) {
        setCache(AIReportCache.fromStorage(changes[AI_REPORTS_KEY].newValue));
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /**
   * Fresh entry for a report id, or `undefined` when missing, past the task's
   * TTL, or produced by a different model.
   */
  const getEntry = useCallback(
    <T,>(id: string, model: string, task: ReportTask): CacheEntry<T> | undefined =>
      cache.get<T>(id, model, task),
    [cache],
  );

  /**
   * Merge a generated report into `aiReports` (read-modify-write against what
   * is on disk so a parallel write is not clobbered) and update local state.
   */
  const save = useCallback(
    async <T,>(id: string, result: T, model: string, task: ReportTask) => {
      const stored = await chrome.storage.local.get(AI_REPORTS_KEY);
      const merged = AIReportCache.fromStorage(stored[AI_REPORTS_KEY]).set(
        id,
        result,
        model,
        task,
      );
      await chrome.storage.local.set({ [AI_REPORTS_KEY]: merged.toJSON() });
      setCache(merged);
    },
    [],
  );

  return { getEntry, save };
}