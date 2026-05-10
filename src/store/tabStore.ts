import { create } from "zustand";
export { useShallow } from "zustand/react/shallow";
import type { EnrichedTab, AppSettings, SavedSession } from "../types/index";
import { DEFAULT_SETTINGS } from "../types/index";

interface TabStore {
  tabs: EnrichedTab[];
  settings: AppSettings;
  sessions: SavedSession[];
  isLoading: boolean;

  setTabs: (tabs: EnrichedTab[]) => void;
  setSettings: (settings: AppSettings) => void;
  setSessions: (sessions: SavedSession[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useTabStore = create<TabStore>((set) => ({
  tabs: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
  isLoading: true,

  setTabs: (tabs) => set({ tabs }),
  setSettings: (settings) => set({ settings }),
  setSessions: (sessions) => set({ sessions }),
  setLoading: (isLoading) => set({ isLoading }),
}));

// ─── Selectors ────────────────────────────────────────────────────────────────

export function selectTabsByDomain(
  tabs: EnrichedTab[],
): Map<string, EnrichedTab[]> {
  const map = new Map<string, EnrichedTab[]>();
  for (const tab of tabs) {
    const domain = tab.domain || "unknown";
    if (!map.has(domain)) map.set(domain, []);
    map.get(domain)!.push(tab);
  }
  // Sort tabs within each domain by lastActiveAt desc
  for (const [, domainTabs] of map) {
    domainTabs.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  }
  return map;
}

export function selectDomainsSorted(
  tabsByDomain: Map<string, EnrichedTab[]>,
): string[] {
  return Array.from(tabsByDomain.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([domain]) => domain);
}
