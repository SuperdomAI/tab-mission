import { useCallback, useEffect, useState } from "react";
import { useTabStore } from "../../store/tabStore";
import { useTabActions } from "./useTabActions";
import { extractPageText } from "../../lib/pageExtract";
import {
  AI_READING_LIST_KEY,
  ReadingList,
  composeSummary,
  entryId,
  generatePageSummary,
  type ReadingEntry,
} from "../../lib/ai/readingList";
import type { EnrichedTab } from "../../types/index";

/**
 * F6 summarize-then-close — mirrors the `aiReadingList` storage key and owns
 * the whole pipeline: extract the page text (`chrome.scripting.executeScript`),
 * summarize with the chat tier (reusing a fresh stored summary for the same
 * page content within the 7-day TTL — no second model call), PERSIST the
 * entry before closing the tab (order guaranteed, same as `saveAndClose`),
 * then close via `useTabActions`. Undo reopens the tab and removes the entry.
 * The service worker never writes this key (UI-owned precedent).
 */
export function useReadingList() {
  const [list, setList] = useState<ReadingList>(ReadingList.empty);
  const settings = useTabStore((s) => s.settings);
  const { close } = useTabActions();

  useEffect(() => {
    let alive = true;
    chrome.storage.local.get(AI_READING_LIST_KEY).then((result) => {
      if (alive) setList(ReadingList.fromStorage(result[AI_READING_LIST_KEY]));
    });
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local" && changes[AI_READING_LIST_KEY] !== undefined) {
        setList(ReadingList.fromStorage(changes[AI_READING_LIST_KEY].newValue));
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /**
   * The F6 pipeline. Returns the stored entry (or null when anything failed —
   * restricted pages, revoked grants, Ollama down — and nothing was closed).
   */
  const summarizeAndClose = useCallback(
    async (tab: EnrichedTab): Promise<ReadingEntry | null> => {
      try {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageText,
        });
        const page = res?.result;
        if (!page || !page.text) return null;
        const id = entryId(page.title, page.text);
        const existing = list.findFresh(id);
        if (existing) {
          await close(tab.id);
          return existing;
        }
        const { summary, whyItMatters } = await generatePageSummary(
          { title: page.title, text: page.text },
          settings.aiChatModel,
        );
        const entry: ReadingEntry = {
          id,
          url: tab.url,
          title: page.title || tab.title,
          summary: composeSummary(summary, whyItMatters),
          savedAt: Date.now(),
        };
        const next = list.add(entry);
        // Persist BEFORE closing — a crash can never lose the summary.
        await chrome.storage.local.set({ [AI_READING_LIST_KEY]: next.toJSON() });
        setList(next);
        await close(tab.id);
        return entry;
      } catch (e) {
        console.error("[TMC] summarize-close error:", e);
        return null;
      }
    },
    [list, settings.aiChatModel, close],
  );

  /** Undo a summarize-close: reopen the tab, drop the reading-list entry. */
  const undoEntry = useCallback(
    async (entry: ReadingEntry) => {
      try {
        await chrome.tabs.create({ url: entry.url, active: false });
      } catch (e) {
        console.error("[TMC] reopen summarized tab error:", e);
      }
      const next = list.remove(entry.id);
      await chrome.storage.local.set({ [AI_READING_LIST_KEY]: next.toJSON() });
      setList(next);
    },
    [list],
  );

  /** Remove an entry from the reading list (drawer ✕ — no reopen). */
  const removeEntry = useCallback(
    async (id: string) => {
      const next = list.remove(id);
      await chrome.storage.local.set({ [AI_READING_LIST_KEY]: next.toJSON() });
      setList(next);
    },
    [list],
  );

  return { entries: list, summarizeAndClose, undoEntry, removeEntry };
}