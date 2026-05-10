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
        className={`drawer-panel fixed top-0 right-0 h-full w-[22rem] z-50 bg-gray-900 border-l border-gray-800/60 shadow-2xl flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-4 h-4 text-indigo-400"
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
            <h2 className="font-semibold text-gray-100 text-base">Analytics</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowWeekly(true)}
              className="text-xs bg-gray-800/80 hover:bg-indigo-900/40 hover:text-indigo-300 text-gray-400 px-3 py-1.5 rounded-lg transition-all border border-gray-700/40 hover:border-indigo-700/40"
            >
              Weekly →
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
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
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Right Now
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Open"
                value={tabs.length}
                icon="🗂"
                color="text-indigo-400"
              />
              <StatCard
                label="Windows"
                value={windows}
                icon="🪟"
                color="text-blue-400"
              />
              <StatCard
                label="Hibernated"
                value={hibernated}
                icon="💤"
                color="text-blue-400"
              />
              <StatCard
                label="Unvisited"
                value={unvisited}
                icon="👻"
                color="text-red-400"
              />
              {pinned > 0 && (
                <StatCard
                  label="Pinned"
                  value={pinned}
                  icon="📌"
                  color="text-yellow-400"
                />
              )}
            </div>
          </section>

          {/* Today's events */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Today
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Opened"
                value={today?.totalTabsOpened ?? 0}
                icon="📂"
                color="text-green-400"
              />
              <StatCard
                label="Closed"
                value={today?.totalTabsClosed ?? 0}
                icon="🗑"
                color="text-red-400"
              />
              <StatCard
                label="Peak"
                value={today?.peakTabCount ?? 0}
                icon="📈"
                color="text-yellow-400"
              />
              <StatCard
                label="vs avg"
                value={Math.abs(tabs.length - avgTabs)}
                icon={tabs.length > avgTabs ? "⬆" : "⬇"}
                color={
                  tabs.length > avgTabs ? "text-red-400" : "text-emerald-400"
                }
                subtitle={tabs.length > avgTabs ? "over avg" : "under avg"}
              />
            </div>
          </section>

          {/* Top domains by time */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Top Domains Today
            </h3>
            {topFive.length === 0 ? (
              <p className="text-sm text-gray-600">
                No time tracked yet today.
              </p>
            ) : (
              <div className="space-y-2.5">
                {topFive.map(({ domain, ms }) => (
                  <div key={domain}>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span className="truncate max-w-40">{domain}</span>
                      <span className="text-gray-500 flex-shrink-0 ml-2">
                        {msToMinutes(ms)}m
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-1.5 bg-indigo-500/70 rounded-full transition-all duration-500"
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
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Tab Trend
              </h3>
              <div className="bg-gray-800/60 rounded-xl p-4 flex items-center gap-4 border border-gray-700/40">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-100 tabular-nums">
                    {tabs.length}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">now</div>
                </div>
                <div className="text-gray-700 text-lg">vs</div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-500 tabular-nums">
                    {avgTabs}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">30-day avg</div>
                </div>
                <div className="flex-1 text-right">
                  {tabs.length > avgTabs ? (
                    <span className="text-red-400 text-sm font-medium">
                      +{tabs.length - avgTabs} over
                    </span>
                  ) : (
                    <span className="text-emerald-400 text-sm font-medium">
                      👍 Under avg
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
  icon,
  color,
  subtitle,
}: {
  label: string;
  value: number;
  icon: string;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/40">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {subtitle && (
        <div className="text-xs text-gray-600 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}
