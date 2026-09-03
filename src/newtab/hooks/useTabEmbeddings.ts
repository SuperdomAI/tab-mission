import { useCallback, useEffect, useState } from "react";
import {
  AI_TAB_EMBEDDINGS_KEY,
  TabEmbeddingCache,
} from "../../lib/ai/tabEmbeddings";

/**
 * Mirrors the `aiTabEmbeddings` storage key (F7 semantic ⌘K search) into
 * React state. The service worker never writes this key — embeddings are a
 * derived, regenerable UI-side cache (the same precedent as `aiReports` /
 * `aiSuggestions`).
 */
export function useTabEmbeddings() {
  const [cache, setCache] = useState<TabEmbeddingCache>(TabEmbeddingCache.empty);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(AI_TAB_EMBEDDINGS_KEY).then((result) => {
      if (alive) setCache(TabEmbeddingCache.fromStorage(result[AI_TAB_EMBEDDINGS_KEY]));
    });
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local" && changes[AI_TAB_EMBEDDINGS_KEY] !== undefined) {
        setCache(TabEmbeddingCache.fromStorage(changes[AI_TAB_EMBEDDINGS_KEY].newValue));
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /** Persist a new embeddings object (callers save only when it changed). */
  const save = useCallback(async (next: TabEmbeddingCache) => {
    await chrome.storage.local.set({ [AI_TAB_EMBEDDINGS_KEY]: next.toJSON() });
    setCache(next);
  }, []);

  return { cache, save };
}