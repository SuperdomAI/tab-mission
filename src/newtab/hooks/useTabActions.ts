import { useCallback } from "react";
import { useTabStore } from "../../store/tabStore";
import type { EnrichedTab, SavedSession } from "../../types/index";

/** Persist a session snapshot and AWAIT the write before returning. */
export async function persistSession(
  name: string,
  tabs: Pick<EnrichedTab, "title" | "url" | "favIconUrl">[],
): Promise<void> {
  const result = (await chrome.storage.local.get("sessions")) as {
    sessions?: SavedSession[];
  };
  const existing: SavedSession[] = result.sessions ?? [];
  const session: SavedSession = {
    id: `session-${Date.now()}`,
    name,
    savedAt: Date.now(),
    tabs: tabs.map((t) => ({
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl,
    })),
  };
  await chrome.storage.local.set({ sessions: [...existing, session].slice(-50) });
}

/**
 * One home for every tab mutation. Closes are optimistic (instant UI) +
 * batched (one chrome.tabs.remove call); on failure we re-sync from storage.
 * Pinned tabs are NEVER auto-closed/hibernated. Hibernate counts real
 * successes (discard silently fails on active/pinned tabs).
 */
export function useTabActions() {
  const removeTabs = useTabStore((s) => s.removeTabs);
  const setTabs = useTabStore((s) => s.setTabs);

  const resync = useCallback(async () => {
    try {
      const r = await chrome.storage.local.get("tabs");
      setTabs((r.tabs as EnrichedTab[]) || []);
    } catch (e) {
      console.error("[TMC] resync error:", e);
    }
  }, [setTabs]);

  const closeMany = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      removeTabs(ids); // optimistic
      try {
        await chrome.tabs.remove(ids); // batched
      } catch (e) {
        console.error("[TMC] closeMany error:", e);
        await resync(); // a remove failed — restore authoritative state
      }
    },
    [removeTabs, resync],
  );

  const close = useCallback((id: number) => closeMany([id]), [closeMany]);

  /** Save the given tabs as a session, THEN close them. Order guaranteed. */
  const saveAndClose = useCallback(
    async (name: string, tabs: EnrichedTab[]) => {
      const closeable = tabs.filter((t) => !t.isPinned);
      if (closeable.length === 0) return;
      await persistSession(name, closeable); // awaited before any close
      await closeMany(closeable.map((t) => t.id));
    },
    [closeMany],
  );

  /** Discard non-pinned, non-hibernated tabs; returns count actually discarded. */
  const hibernateMany = useCallback(
    async (tabs: EnrichedTab[]): Promise<number> => {
      const eligible = tabs.filter((t) => !t.isPinned && !t.isHibernated);
      const results = await Promise.allSettled(
        eligible.map((t) => chrome.tabs.discard(t.id)),
      );
      return results.filter((r) => r.status === "fulfilled").length;
    },
    [],
  );

  const hibernate = useCallback(
    (tab: EnrichedTab) => hibernateMany([tab]),
    [hibernateMany],
  );

  const jumpTo = useCallback(async (tab: EnrichedTab) => {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      console.error("[TMC] jumpTo error:", e);
    }
  }, []);

  return { close, closeMany, saveAndClose, hibernate, hibernateMany, jumpTo, resync };
}
