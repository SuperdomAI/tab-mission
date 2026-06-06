import { useEffect, useRef, useTransition } from "react";
import { useTabStore } from "../../store/tabStore";
import { useAnalyticsStore } from "../../store/analyticsStore";
import type {
  EnrichedTab,
  DailyAnalytics,
  AppSettings,
  SavedSession,
  Workspace,
  WorkspaceUndo,
} from "../../types/index";
import { DEFAULT_SETTINGS } from "../../types/index";

/**
 * Loads all data from chrome.storage.local on mount and subscribes to storage
 * changes so the UI stays in sync with the background service worker.
 *
 * The service worker writes `tabs` on every tab event; a burst (e.g. restoring
 * a session that opens 30 tabs) fires many onChanged events. We coalesce those
 * EXTERNAL bursts into one update per animation frame. User-initiated closes
 * are already optimistic in the store, so they don't wait on this path.
 */
export function useTabs() {
  const setTabs = useTabStore((s) => s.setTabs);
  const setSettings = useTabStore((s) => s.setSettings);
  const setSessions = useTabStore((s) => s.setSessions);
  const setWorkspaces = useTabStore((s) => s.setWorkspaces);
  const setWorkspaceUndo = useTabStore((s) => s.setWorkspaceUndo);
  const setLoading = useTabStore((s) => s.setLoading);
  const hydrateViewMode = useTabStore((s) => s.hydrateViewMode);
  const setAnalytics = useAnalyticsStore((s) => s.setAnalytics);
  const [, startTransition] = useTransition();

  const pendingTabs = useRef<EnrichedTab[] | null>(null);
  const rafId = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    async function load() {
      try {
        const result = await chrome.storage.local.get([
          "tabs",
          "analytics",
          "sessions",
          "workspaces",
          "workspaceUndo",
          "viewMode",
        ]);
        const settingsResult = await chrome.storage.sync.get("settings");

        startTransition(() => {
          setTabs((result.tabs as EnrichedTab[]) || []);
          setAnalytics((result.analytics as DailyAnalytics[]) || []);
          setSessions((result.sessions as SavedSession[]) || []);
          setWorkspaces((result.workspaces as Workspace[]) || []);
          setWorkspaceUndo((result.workspaceUndo as WorkspaceUndo) ?? null);
          if (result.viewMode === "stacks" || result.viewMode === "timeline") {
            hydrateViewMode(result.viewMode);
          }
          setSettings(
            (settingsResult.settings as AppSettings) || DEFAULT_SETTINGS,
          );
          setLoading(false);
        });
      } catch (e) {
        console.error("[TMC] useTabs load error:", e);
        setLoading(false);
      }
    }

    load();
  }, []);

  // Subscribe to storage changes from background
  useEffect(() => {
    function flushTabs() {
      rafId.current = null;
      const next = pendingTabs.current;
      pendingTabs.current = null;
      if (next) startTransition(() => setTabs(next));
    }

    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local") {
        // Coalesce tabs bursts into one update per frame (latest wins).
        if (changes.tabs?.newValue !== undefined) {
          pendingTabs.current = changes.tabs.newValue as EnrichedTab[];
          if (rafId.current === null) {
            rafId.current = requestAnimationFrame(flushTabs);
          }
        }
        startTransition(() => {
          if (changes.analytics?.newValue !== undefined) {
            setAnalytics(changes.analytics.newValue as DailyAnalytics[]);
          }
          if (changes.sessions?.newValue !== undefined) {
            setSessions(changes.sessions.newValue as SavedSession[]);
          }
          if (changes.workspaces?.newValue !== undefined) {
            setWorkspaces(changes.workspaces.newValue as Workspace[]);
          }
          if ("workspaceUndo" in changes) {
            setWorkspaceUndo(
              (changes.workspaceUndo.newValue as WorkspaceUndo) ?? null,
            );
          }
          if (
            changes.viewMode?.newValue === "stacks" ||
            changes.viewMode?.newValue === "timeline"
          ) {
            hydrateViewMode(changes.viewMode.newValue);
          }
        });
      }
      if (area === "sync") {
        startTransition(() => {
          if (changes.settings?.newValue !== undefined) {
            setSettings(changes.settings.newValue as AppSettings);
          }
        });
      }
    }

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);
}
