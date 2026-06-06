import { create } from "zustand";
export { useShallow } from "zustand/react/shallow";
import type {
  EnrichedTab,
  AppSettings,
  SavedSession,
  Workspace,
  WorkspaceUndo,
} from "../types/index";
import { DEFAULT_SETTINGS } from "../types/index";

export type ViewMode = "stacks" | "timeline";

interface TabStore {
  tabs: EnrichedTab[];
  settings: AppSettings;
  sessions: SavedSession[];
  workspaces: Workspace[];
  workspaceUndo: WorkspaceUndo | null;
  isLoading: boolean;
  viewMode: ViewMode;

  setTabs: (tabs: EnrichedTab[]) => void;
  setSettings: (settings: AppSettings) => void;
  setSessions: (sessions: SavedSession[]) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setWorkspaceUndo: (undo: WorkspaceUndo | null) => void;
  setLoading: (loading: boolean) => void;
  /** Persisting setter — for UI controls. */
  setViewMode: (mode: ViewMode) => void;
  /** Non-persisting setter — for hydrating from storage (avoids write loops). */
  hydrateViewMode: (mode: ViewMode) => void;
  /**
   * Optimistic removal: drop tabs from the mirror immediately so the UI feels
   * instant. The authoritative state still arrives via chrome.storage.onChanged
   * once the service worker processes the real tab removal; on failure the
   * caller re-syncs from storage.
   */
  removeTabs: (ids: number[]) => void;
}

export const useTabStore = create<TabStore>((set) => ({
  tabs: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
  workspaces: [],
  workspaceUndo: null,
  isLoading: true,
  viewMode: "stacks",

  setTabs: (tabs) => set({ tabs }),
  setSettings: (settings) => set({ settings }),
  setSessions: (sessions) => set({ sessions }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setWorkspaceUndo: (workspaceUndo) => set({ workspaceUndo }),
  setLoading: (isLoading) => set({ isLoading }),
  setViewMode: (viewMode) => {
    set({ viewMode });
    // Persist as a per-device UI preference (best-effort).
    try {
      chrome.storage?.local?.set({ viewMode });
    } catch {
      /* ignore in non-extension contexts */
    }
  },
  hydrateViewMode: (viewMode) => set({ viewMode }),
  removeTabs: (ids) =>
    set((s) => {
      const drop = new Set(ids);
      return { tabs: s.tabs.filter((t) => !drop.has(t.id)) };
    }),
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
