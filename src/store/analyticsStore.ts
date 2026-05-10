import { create } from 'zustand';
import type { DailyAnalytics } from '../types/index';

interface AnalyticsStore {
  analytics: DailyAnalytics[];
  setAnalytics: (analytics: DailyAnalytics[]) => void;
}

export const useAnalyticsStore = create<AnalyticsStore>((set) => ({
  analytics: [],
  setAnalytics: (analytics) => set({ analytics }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function todayAnalytics(analytics: DailyAnalytics[]): DailyAnalytics | null {
  const today = new Date().toISOString().slice(0, 10);
  return analytics.find((d) => d.date === today) ?? null;
}

export function last7Days(analytics: DailyAnalytics[]): DailyAnalytics[] {
  const result: DailyAnalytics[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const existing = analytics.find((a) => a.date === key);
    result.push(
      existing ?? {
        date: key,
        totalTabsOpened: 0,
        totalTabsClosed: 0,
        peakTabCount: 0,
        domainTime: {},
        distractionDomains: [],
        tabDebtScore: 0,
      }
    );
  }
  return result;
}

export function topDomains(
  domainTime: Record<string, number>,
  n = 5
): { domain: string; ms: number }[] {
  return Object.entries(domainTime)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([domain, ms]) => ({ domain, ms }));
}
