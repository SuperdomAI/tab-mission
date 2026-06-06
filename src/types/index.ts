export interface EnrichedTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl: string;
  domain: string;
  openedAt: number;
  lastActiveAt: number | null;
  totalActiveTime: number;
  visitCount: number;
  isVisited: boolean;
  isPinned: boolean;
  groupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  isHibernated: boolean;
  tags: string[];
}

export interface DailyAnalytics {
  date: string; // YYYY-MM-DD
  totalTabsOpened: number;
  totalTabsClosed: number;
  peakTabCount: number;
  domainTime: Record<string, number>;
  distractionDomains: string[];
  tabDebtScore: number;
}

export interface SavedSession {
  id: string;
  name: string;
  savedAt: number;
  tabs: { title: string; url: string; favIconUrl: string }[];
}

export interface AppSettings {
  workDomains: string[];
  zombieThresholdHours: number;
  unvisitedAutoCloseEnabled: boolean;
  unvisitedAutoCloseMinutes: number;
  tabLimitWarning: number;
  theme: "dark" | "light";
  /** Optional local-AI assist via Ollama (off by default, fully optional). */
  ollamaEnabled: boolean;
  ollamaModel: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  workDomains: [],
  zombieThresholdHours: 3,
  unvisitedAutoCloseEnabled: false,
  unvisitedAutoCloseMinutes: 30,
  tabLimitWarning: 30,
  theme: "dark",
  ollamaEnabled: false,
  ollamaModel: "llama3.2",
};

/**
 * A named, goal-driven set-aside of tabs. Phase 2 "Workspaces": type a goal,
 * the irrelevant tabs are snapshotted here and closed (reversibly), and can be
 * restored later. Stored UI-side under "workspaces" (avoids the shared-writer
 * hazard the `sessions` key has).
 */
export const WORKSPACE_SCHEMA_VERSION = 1;

export interface Workspace {
  id: string; // "workspace-<timestamp>"
  schemaVersion: number;
  goal: string;
  createdAt: number;
  /** the set-aside (stashed) tabs, in the SavedSession snapshot shape */
  tabs: { title: string; url: string; favIconUrl: string }[];
}

/** Points at the most recent stash so it can be one-click undone. */
export interface WorkspaceUndo {
  workspaceId: string;
  createdAt: number;
  count: number;
}

export type StorageKey =
  | "tabs"
  | "analytics"
  | "sessions"
  | "settings"
  | "workspaces"
  | "workspaceUndo"
  | "viewMode";
