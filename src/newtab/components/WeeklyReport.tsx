import React from "react";
import { format } from "date-fns";
import {
  useAnalyticsStore,
  last7Days,
  topDomains,
} from "../../store/analyticsStore";

interface WeeklyReportProps {
  open: boolean;
  onClose: () => void;
}

function msToHours(ms: number) {
  return (ms / 3_600_000).toFixed(1);
}

export default function WeeklyReport({ open, onClose }: WeeklyReportProps) {
  const analytics = useAnalyticsStore((s) => s.analytics);
  const week = last7Days(analytics);

  const maxOpened = Math.max(...week.map((d) => d.totalTabsOpened), 1);

  const totalOpened = week.reduce((s, d) => s + d.totalTabsOpened, 0);
  const totalClosed = week.reduce((s, d) => s + d.totalTabsClosed, 0);
  const totalTrackedMs = week.reduce(
    (s, d) => s + Object.values(d.domainTime).reduce((a, b) => a + b, 0),
    0,
  );

  // Combined domain time for the week
  const combinedDomainTime: Record<string, number> = {};
  for (const day of week) {
    for (const [domain, ms] of Object.entries(day.domainTime)) {
      combinedDomainTime[domain] = (combinedDomainTime[domain] || 0) + ms;
    }
  }
  const topDomain = Object.entries(combinedDomainTime).sort(
    (a, b) => b[1] - a[1],
  )[0];

  // Busiest tab day (most opened)
  const busiestDay = week.reduce(
    (best, d) => (d.totalTabsOpened > (best?.totalTabsOpened ?? 0) ? d : best),
    week[0],
  );

  // Best cleanup day (most closed)
  const bestCleanupDay = week.reduce(
    (best, d) => (d.totalTabsClosed > (best?.totalTabsClosed ?? 0) ? d : best),
    week[0],
  );

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={`drawer-panel fixed top-0 right-0 h-full w-[28rem] z-[70] bg-gray-900 border-l border-gray-800/60 shadow-2xl flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
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
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h2 className="font-semibold text-gray-100 text-base">
              Weekly Report
            </h2>
          </div>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Weekly totals */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              7-Day Totals
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/40">
                <div className="text-2xl font-bold text-green-400 tabular-nums">
                  {totalOpened}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Opened</div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/40">
                <div className="text-2xl font-bold text-red-400 tabular-nums">
                  {totalClosed}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Closed</div>
              </div>
              <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/40">
                <div className="text-2xl font-bold text-indigo-400 tabular-nums">
                  {msToHours(totalTrackedMs)}h
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Tracked</div>
              </div>
            </div>
          </section>

          {/* Most visited domain */}
          {topDomain && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Most Visited Domain
              </h3>
              <div className="bg-indigo-900/30 border border-indigo-700/40 rounded-xl p-4">
                <div className="text-base font-bold text-indigo-300 truncate">
                  {topDomain[0]}
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {msToHours(topDomain[1])} hours this week
                </div>
              </div>
            </section>
          )}

          {/* Daily bar chart */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Daily Tabs Opened
            </h3>
            <div className="flex items-end gap-1.5 h-24">
              {week.map((day) => {
                const heightPct = (day.totalTabsOpened / maxOpened) * 100;
                const isBusiest =
                  day.date === busiestDay?.date && day.totalTabsOpened > 0;
                const isBestCleanup =
                  day.date === bestCleanupDay?.date && day.totalTabsClosed > 0;

                return (
                  <div
                    key={day.date}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    <div className="relative w-full" style={{ height: "80px" }}>
                      <div
                        className={`absolute bottom-0 w-full rounded-t transition-all duration-500 ${
                          isBusiest
                            ? "bg-amber-500/70"
                            : isBestCleanup
                              ? "bg-emerald-500/70"
                              : "bg-indigo-500/50"
                        }`}
                        style={{ height: `${Math.max(2, heightPct)}%` }}
                        title={`Opened: ${day.totalTabsOpened}, Closed: ${day.totalTabsClosed}`}
                      />
                    </div>
                    <span className="text-xs text-gray-600">
                      {format(new Date(day.date), "EEE")}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 mt-2 text-xs text-gray-600">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-amber-500/70 inline-block" />{" "}
                Busiest
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-emerald-500/70 inline-block" />{" "}
                Most closed
              </span>
            </div>
          </section>

          {/* Per-day domain breakdown */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Daily Top Domains
            </h3>
            <div className="space-y-3">
              {week.map((day) => {
                const top3 = topDomains(day.domainTime, 3);
                if (top3.length === 0) return null;
                return (
                  <div key={day.date}>
                    <div className="text-xs text-gray-600 mb-1.5">
                      {format(new Date(day.date), "EEE, MMM d")}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {top3.map(({ domain, ms }) => (
                        <span
                          key={domain}
                          className="text-xs bg-gray-800/60 text-gray-400 px-2 py-1 rounded-lg border border-gray-700/40"
                          title={`${Math.round(ms / 60_000)} min`}
                        >
                          {domain}{" "}
                          <span className="text-gray-600">
                            {Math.round(ms / 60_000)}m
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
