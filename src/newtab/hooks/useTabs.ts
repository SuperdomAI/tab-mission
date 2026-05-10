import { useEffect, useTransition } from "react";
import { useTabStore } from "../../store/tabStore";
import { useAnalyticsStore } from "../../store/analyticsStore";
import type {
  EnrichedTab,
  DailyAnalytics,
  AppSettings,
  SavedSession,
} from "../../types/index";
import { DEFAULT_SETTINGS } from "../../types/index";

/**
 * Loads all data from chrome.storage.local on mount and subscribes to
 * storage changes so the UI stays in sync with the background service worker.
 */
export function useTabs() {
  const setTabs = useTabStore((s) => s.setTabs);
  const setSettings = useTabStore((s) => s.setSettings);
  const setSessions = useTabStore((s) => s.setSessions);
  const setLoading = useTabStore((s) => s.setLoading);
  const setAnalytics = useAnalyticsStore((s) => s.setAnalytics);
  const [, startTransition] = useTransition();

  // Initial load
  useEffect(() => {
    async function load() {
      try {
        const result = await chrome.storage.local.get([
          "tabs",
          "analytics",
          "sessions",
        ]);
        const settingsResult = await chrome.storage.sync.get("settings");

        startTransition(() => {
          setTabs((result.tabs as EnrichedTab[]) || []);
          setAnalytics((result.analytics as DailyAnalytics[]) || []);
          setSessions((result.sessions as SavedSession[]) || []);
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
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "local") {
        startTransition(() => {
          if (changes.tabs?.newValue !== undefined) {
            setTabs(changes.tabs.newValue as EnrichedTab[]);
          }
          if (changes.analytics?.newValue !== undefined) {
            setAnalytics(changes.analytics.newValue as DailyAnalytics[]);
          }
          if (changes.sessions?.newValue !== undefined) {
            setSessions(changes.sessions.newValue as SavedSession[]);
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
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
}
