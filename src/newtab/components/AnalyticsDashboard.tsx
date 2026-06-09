import React, { useState } from "react";
import {
  useAnalyticsStore,
  todayAnalytics,
  topDomains,
} from "../../store/analyticsStore";
import { useTabStore, useShallow } from "../../store/tabStore";
import WeeklyReport from "./WeeklyReport";

interface AnalyticsDashboardProps {
  open: boolean;
  onClose: () => void;
}

function msToMinutes(ms: number) {
  return Math.round(ms / 60_000);
}

export default function AnalyticsDashboard({
  open,
  onClose,
}: AnalyticsDashboardProps) {
  const analytics = useAnalyticsStore((s) => s.analytics);
  const { tabs } = useTabStore(useShallow((s) => ({ tabs: s.tabs })));
  const [showWeekly, setShowWeekly] = useState(false);

  const today = todayAnalytics(analytics);
  const topFive = today ? topDomains(today.domainTime, 5) : [];
  const maxMs = topFive[0]?.ms || 1;

  const hibernated = tabs.filter((t) => t.isHibernated).length;
  const unvisited = tabs.filter((t) => t.visitCount === 0).length;
  const pinned = tabs.filter((t) => t.isPinned).length;
  const windows = new Set(tabs.map((t) => t.windowId)).size;

  // Daily average tab count
  const avgTabs =
    analytics.length > 0
      ? Math.round(
          analytics.reduce((s, d) => s + d.tabDebtScore, 0) / analytics.length,
        )
      : 0;

  const overAvg = tabs.length > avgTabs;

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={`drawer-panel fixed top-0 right-0 h-full w-[22rem] z-50 bg-popover border-l border-hairline shadow-2xl flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-4 h-4 text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <h2 className="font-semibold text-ink text-base">Analytics</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowWeekly(true)}
              className="text-xs text-muted bg-white/[0.04] hover:text-ink hover:bg-white/[0.07] px-3 py-1.5 rounded-[9px] transition-colors border border-border"
            >
              Weekly →
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[9px] text-faint hover:text-ink hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Current snapshot */}
          <section>
            <h3 className="label-mono mb-3">Right Now</h3>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Open" value={tabs.length} />
              <StatCard label="Windows" value={windows} />
              <StatCard
                label="Hibernated"
                value={hibernated}
                valueClass="text-status-hibernated"
              />
              <StatCard
                label="Unvisited"
                value={unvisited}
                valueClass="text-status-unvisited"
              />
              {pinned > 0 && <StatCard label="Pinned" value={pinned} />}
            </div>
          </section>

          {/* Today's events */}
          <section>
            <h3 className="label-mono mb-3">Today</h3>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Opened" value={today?.totalTabsOpened ?? 0} />
              <StatCard label="Closed" value={today?.totalTabsClosed ?? 0} />
              <StatCard label="Peak" value={today?.peakTabCount ?? 0} />
              <StatCard
                label="vs avg"
                value={Math.abs(tabs.length - avgTabs)}
                valueClass={
                  overAvg ? "text-status-unvisited" : "text-status-recent"
                }
                subtitle={overAvg ? "over avg" : "under avg"}
              />
            </div>
          </section>

          {/* Top domains by time */}
          <section>
            <h3 className="label-mono mb-3">Top Domains Today</h3>
            {topFive.length === 0 ? (
              <p className="text-sm text-faint">No time tracked yet today.</p>
            ) : (
              <div className="space-y-2.5">
                {topFive.map(({ domain, ms }) => (
                  <div key={domain}>
                    <div className="flex justify-between text-xs text-muted mb-1">
                      <span className="truncate max-w-40">{domain}</span>
                      <span className="font-mono text-faint flex-shrink-0 ml-2">
                        {msToMinutes(ms)}m
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-1.5 bg-accent/70 rounded-full transition-all duration-500"
                        style={{ width: `${(ms / maxMs) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Tab debt trend */}
          {avgTabs > 0 && (
            <section>
              <h3 className="label-mono mb-3">Tab Trend</h3>
              <div className="bg-surface rounded-xl p-4 flex items-center gap-4 border border-hairline">
                <div className="text-center">
                  <div className="text-2xl font-mono text-ink tabular-nums">
                    {tabs.length}
                  </div>
                  <div className="text-xs text-faint mt-0.5">now</div>
                </div>
                <div className="text-faint text-lg">vs</div>
                <div className="text-center">
                  <div className="text-2xl font-mono text-muted tabular-nums">
                    {avgTabs}
                  </div>
                  <div className="text-xs text-faint mt-0.5">30-day avg</div>
                </div>
                <div className="flex-1 text-right">
                  {overAvg ? (
                    <span className="text-status-unvisited text-sm font-medium">
                      +{tabs.length - avgTabs} over
                    </span>
                  ) : (
                    <span className="text-status-recent text-sm font-medium">
                      Under avg
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </aside>

      <WeeklyReport open={showWeekly} onClose={() => setShowWeekly(false)} />
    </>
  );
}

function StatCard({
  label,
  value,
  valueClass = "text-ink",
  subtitle,
}: {
  label: string;
  value: number;
  valueClass?: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-surface rounded-xl p-3 border border-hairline">
      <div className="label-mono mb-1.5">{label}</div>
      <div className={`text-2xl font-mono tabular-nums ${valueClass}`}>
        {value}
      </div>
      {subtitle && <div className="text-xs text-faint mt-0.5">{subtitle}</div>}
    </div>
  );
}
