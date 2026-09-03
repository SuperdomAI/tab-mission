import { useCallback, useEffect, useState } from "react";
import {
  AI_SUGGESTIONS_KEY,
  SuggestionsCache,
  type Suggestions,
} from "../../lib/ai/suggestions";

/**
 * Mirrors the `aiSuggestions` storage key (F3 proactive suggestions) into
 * React state. The service worker never writes this key — suggestions are a
 * derived, regenerable UI-side cache (the same precedent as `aiReports`).
 */
export function useSuggestions() {
  const [cache, setCache] = useState<SuggestionsCache>(SuggestionsCache.empty);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(AI_SUGGESTIONS_KEY).then((result) => {
      if (alive) setCache(SuggestionsCache.fromStorage(result[AI_SUGGESTIONS_KEY]));
    });
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local" && changes[AI_SUGGESTIONS_KEY] !== undefined) {
        setCache(SuggestionsCache.fromStorage(changes[AI_SUGGESTIONS_KEY].newValue));
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /**
   * The plan to show for this tab set + model, or undefined when it should be
   * regenerated (missing, stale, model-mismatched, or ≥ 5-tab change).
   */
  const getFresh = useCallback(
    (signature: string, model: string, tabCount: number) =>
      cache.get(signature, model, tabCount),
    [cache],
  );

  /** Persist a generated plan (dismissed resets to false on new generations). */
  const save = useCallback(async (plan: Suggestions) => {
    await chrome.storage.local.set({ [AI_SUGGESTIONS_KEY]: plan });
    setCache(SuggestionsCache.fromStorage(plan));
  }, []);

  /** Hide the strip for this plan's lifetime (until the next generation). */
  const dismiss = useCallback(async (plan: Suggestions) => {
    const next: Suggestions = { ...plan, dismissed: true };
    await chrome.storage.local.set({ [AI_SUGGESTIONS_KEY]: next });
    setCache(SuggestionsCache.fromStorage(next));
  }, []);

  return { getFresh, save, dismiss };
}