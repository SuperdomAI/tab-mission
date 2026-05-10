import React, { useState, useTransition } from "react";
import type { EnrichedTab } from "../../types/index";
import TabCard from "./TabCard";
import Tooltip from "./Tooltip";

interface DomainGroupProps {
  domain: string;
  tabs: EnrichedTab[];
}

export default function DomainGroup({ domain, tabs }: DomainGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [, startTransition] = useTransition();

  const favicon = tabs[0]?.favIconUrl || "";

  const zombieCount = tabs.filter(
    (t) =>
      t.lastActiveAt !== null && t.lastActiveAt < Date.now() - 2 * 3_600_000,
  ).length;
  const unvisitedCount = tabs.filter((t) => t.visitCount === 0).length;
  const hibernatedCount = tabs.filter((t) => t.isHibernated).length;

  function closeAll(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      for (const t of tabs) {
        try {
          await chrome.tabs.remove(t.id);
        } catch {}
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-800/60 overflow-hidden transition-colors duration-200 group/domain hover:border-gray-700/60">
      {/* ── Domain header ─────────────────────────────────────────────── */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2.5 px-3 py-2.5 bg-gray-800/50 hover:bg-gray-800/70 cursor-pointer select-none transition-colors duration-150"
      >
        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 text-gray-600 flex-shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>

        {/* Favicon */}
        {favicon ? (
          <img
            src={favicon}
            alt=""
            className="w-4 h-4 rounded-sm flex-shrink-0"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="w-4 h-4 rounded-sm bg-gray-600 flex-shrink-0" />
        )}

        {/* Domain */}
        <span className="text-gray-200 font-medium text-sm flex-1 truncate min-w-0">
          {domain}
        </span>

        {/* Warning chips */}
        <div className="flex items-center gap-1.5 ml-1">
          {unvisitedCount > 0 && (
            <Tooltip
              text={`${unvisitedCount} unvisited tab${unvisitedCount !== 1 ? "s" : ""}`}
            >
              <span className="text-xs text-red-500 bg-red-900/20 px-1.5 py-0.5 rounded-full cursor-default">
                👻 {unvisitedCount}
              </span>
            </Tooltip>
          )}
          {zombieCount > 0 && (
            <Tooltip
              text={`${zombieCount} zombie tab${zombieCount !== 1 ? "s" : ""} (inactive 2+ hours)`}
            >
              <span className="text-xs text-amber-500 bg-amber-900/20 px-1.5 py-0.5 rounded-full cursor-default">
                🧟 {zombieCount}
              </span>
            </Tooltip>
          )}
          {hibernatedCount > 0 && (
            <Tooltip
              text={`${hibernatedCount} tab${hibernatedCount !== 1 ? "s" : ""} hibernated`}
            >
              <span className="text-xs text-blue-500/80 bg-blue-900/20 px-1.5 py-0.5 rounded-full cursor-default">
                💤 {hibernatedCount}
              </span>
            </Tooltip>
          )}
        </div>

        {/* Tab count */}
        <Tooltip
          text={`${tabs.length} tab${tabs.length !== 1 ? "s" : ""} from ${domain}`}
        >
          <span className="text-xs text-gray-500 bg-gray-700/60 px-2 py-0.5 rounded-full cursor-default flex-shrink-0 tabular-nums">
            {tabs.length}
          </span>
        </Tooltip>

        {/* Close all — appears on group hover */}
        <Tooltip
          text={`Close all ${tabs.length} tab${tabs.length !== 1 ? "s" : ""} from ${domain}`}
        >
          <button
            onClick={closeAll}
            className="opacity-0 group-hover/domain:opacity-100 text-xs text-gray-600 hover:text-red-400 hover:bg-red-900/20 px-2 py-0.5 rounded-md transition-all flex-shrink-0 ml-1"
          >
            Close all
          </button>
        </Tooltip>
      </div>

      {/* ── Animated tab grid (CSS grid trick for smooth collapse) ──────── */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 0.22s ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 bg-gray-900/30">
            {tabs.map((tab) => (
              <TabCard key={tab.id} tab={tab} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
