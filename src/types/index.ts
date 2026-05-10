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
}

export const DEFAULT_SETTINGS: AppSettings = {
  workDomains: [],
  zombieThresholdHours: 3,
  unvisitedAutoCloseEnabled: false,
  unvisitedAutoCloseMinutes: 30,
  tabLimitWarning: 30,
  theme: "dark",
};

export type StorageKey = "tabs" | "analytics" | "sessions" | "settings";
