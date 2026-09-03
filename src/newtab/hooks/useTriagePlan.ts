import { useCallback, useEffect, useState } from "react";
import {
  AI_TRIAGE_KEY,
  IDLE_DISMISS_KEY,
  TriageCache,
  type TriagePlan,
} from "../../lib/ai/triage";

/**
 * Mirrors the `aiTriagePlan` storage key (F2 on-demand + F12 idle drafts)
 * and the `aiIdleDraftDismissedAt` notice flag into React state. The service
 * worker writes idle drafts; the React layer writes on-demand plans and the
 * dismissal flag — both sides coerce through the same `TriageCache`.
 */
export function useTriagePlan() {
  const [cache, setCache] = useState<TriageCache>(() => TriageCache.empty());
  const [dismissedAt, setDismissedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get([AI_TRIAGE_KEY, IDLE_DISMISS_KEY]).then((result) => {
      if (!alive) return;
      setCache(TriageCache.fromStorage(result[AI_TRIAGE_KEY]));
      const dismissed = result[IDLE_DISMISS_KEY];
      setDismissedAt(typeof dismissed === "number" ? dismissed : 0);
    });
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area !== "local") return;
      if (changes[AI_TRIAGE_KEY] !== undefined) {
        setCache(TriageCache.fromStorage(changes[AI_TRIAGE_KEY].newValue));
      }
      if (changes[IDLE_DISMISS_KEY] !== undefined) {
        const dismissed = changes[IDLE_DISMISS_KEY].newValue;
        setDismissedAt(typeof dismissed === "number" ? dismissed : 0);
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /** Fresh plan for this tab-set signature + model (TTL by source). */
  const getFresh = useCallback(
    (signature: string, model: string) => cache.get(signature, model),
    [cache],
  );

  /** The latest fresh idle-sourced draft (input for the Timeline notice chip). */
  const idlePlan = useCallback(() => cache.idlePlan(), [cache]);

  /** Persist a plan (on-demand generation). */
  const save = useCallback(async (plan: TriagePlan) => {
    await chrome.storage.local.set({ [AI_TRIAGE_KEY]: plan });
    setCache(TriageCache.fromStorage(plan));
  }, []);

  /** Consume the stored plan (approval) — also clears the idle notice. */
  const clear = useCallback(async () => {
    await chrome.storage.local.remove(AI_TRIAGE_KEY);
    setCache(TriageCache.empty());
  }, []);

  /** Dismiss the "while you were away" notice until a NEW idle draft arrives. */
  const dismissIdleDraft = useCallback(async () => {
    const now = Date.now();
    await chrome.storage.local.set({ [IDLE_DISMISS_KEY]: now });
    setDismissedAt(now);
  }, []);

  return { getFresh, idlePlan, dismissedAt, save, clear, dismissIdleDraft };
}