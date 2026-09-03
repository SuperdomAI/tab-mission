import { DEFAULT_PROFILE } from "../lib/ai/models";

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
  /** Model per task tier (see `src/lib/ai/models.ts` for recommendations). */
  aiFastModel: string;
  aiChatModel: string;
  aiEmbedModel: string;
  /** Gates F6/F7 page reading; requests `scripting` + host grants on first enable. */
  aiPageReadingEnabled: boolean;
  /** Per-feature toggles — default ON once the AI Assist master is on. */
  aiDebrief: boolean;
  aiTriage: boolean;
  aiSuggestions: boolean;
  aiSessionMemory: boolean;
  aiSemanticSearch: boolean;
  aiCoach: boolean;
  aiIdleDrafts: boolean;
}

/**
 * Merge stored settings over the defaults so settings added in later releases
 * (e.g. the AI fields) are never `undefined` for users with older saved
 * settings in `chrome.storage.sync`. `stored` is a full-or-partial object.
 *
 * One-time legacy migration: AskAI and Focus "Refine with AI" used to read
 * `ollamaModel`; the chat tier (`aiChatModel`) now owns that role. When a user
 * had chosen a legacy model and never touched the new field, carry it over
 * once so their model keeps working.
 */
export function mergeSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (
    stored?.ollamaModel !== undefined &&
    stored.ollamaModel !== DEFAULT_SETTINGS.ollamaModel &&
    merged.aiChatModel === DEFAULT_SETTINGS.aiChatModel
  ) {
    merged.aiChatModel = stored.ollamaModel;
  }
  return merged;
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
  aiFastModel: DEFAULT_PROFILE.fast,
  aiChatModel: DEFAULT_PROFILE.chat,
  aiEmbedModel: DEFAULT_PROFILE.embed,
  aiPageReadingEnabled: false,
  aiDebrief: true,
  aiTriage: true,
  aiSuggestions: true,
  aiSessionMemory: true,
  aiSemanticSearch: true,
  aiCoach: true,
  aiIdleDrafts: true,
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
