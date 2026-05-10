import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTabs } from "./hooks/useTabs";
import {
  useTabStore,
  useShallow,
  selectTabsByDomain,
  selectDomainsSorted,
} from "../store/tabStore";
import SearchBar from "./components/SearchBar";
import DomainGroup from "./components/DomainGroup";
import BulkActions from "./components/BulkActions";
import SessionManager from "./components/SessionManager";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import Settings from "./components/Settings";
import Tooltip from "./components/Tooltip";

export default function App() {
  useTabs();

  const { tabs, isLoading, settings } = useTabStore(
    useShallow((s) => ({
      tabs: s.tabs,
      isLoading: s.isLoading,
      settings: s.settings,
    })),
  );

  const [showSessions, setShowSessions] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const tabsByDomain = selectTabsByDomain(tabs);
  const sortedDomains = selectDomainsSorted(tabsByDomain);

  const tabCount = tabs.length;
  const overLimit = tabCount >= settings.tabLimitWarning;

  const stats = useMemo(
    () => ({
      hibernated: tabs.filter((t) => t.isHibernated).length,
      unvisited: tabs.filter((t) => t.visitCount === 0).length,
      zombies: tabs.filter(
        (t) =>
          t.lastActiveAt !== null &&
          t.lastActiveAt <
            Date.now() - settings.zombieThresholdHours * 3_600_000,
      ).length,
      windows: new Set(tabs.map((t) => t.windowId)).size,
      domains: tabsByDomain.size,
      pinned: tabs.filter((t) => t.isPinned).length,
    }),
    [tabs, settings.zombieThresholdHours, tabsByDomain.size],
  );

  // ⌘K / Ctrl+K → focus search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex-none z-30 bg-gray-900/95 backdrop-blur-md border-b border-gray-800/60 px-4 py-2.5 flex items-center gap-3">
        {/* Brand */}
        <Tooltip text="Tab Mission Control — browser tab manager">
          <div className="flex items-center gap-2 flex-shrink-0 cursor-default select-none">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm shadow-lg shadow-indigo-900/50 flex-shrink-0">
              🗂
            </div>
            <span className="font-semibold text-gray-200 text-sm tracking-tight hidden md:block">
              Mission Control
            </span>
          </div>
        </Tooltip>

        <div className="w-px h-5 bg-gray-800 hidden md:block flex-shrink-0" />

        {/* Search */}
        <div className="flex-1 min-w-0">
          <SearchBar inputRef={searchInputRef} />
        </div>

        {/* Tab count badge */}
        <Tooltip
          text={
            overLimit
              ? `⚠ Over your ${settings.tabLimitWarning}-tab limit!`
              : `${tabCount} tab${tabCount !== 1 ? "s" : ""} across ${stats.windows} window${stats.windows !== 1 ? "s" : ""}`
          }
        >
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold cursor-default select-none transition-all ${
              overLimit
                ? "bg-red-500/20 text-red-400 border border-red-500/40 ring-pulse-red"
                : "bg-gray-800/80 text-gray-300 border border-gray-700/50"
            }`}
          >
            <span className="text-sm font-bold tabular-nums">{tabCount}</span>
            <span className="text-gray-500 font-normal">tabs</span>
            {overLimit && <span className="text-red-400 text-xs">⚠</span>}
          </div>
        </Tooltip>

        {/* Analytics */}
        <Tooltip text="Tab analytics & stats">
          <button
            onClick={() => setShowAnalytics(true)}
            className="p-2 rounded-lg text-gray-500 hover:text-indigo-400 hover:bg-indigo-950/60 transition-all"
            aria-label="Analytics"
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
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </button>
        </Tooltip>

        {/* Settings */}
        <Tooltip text="Settings">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
            aria-label="Settings"
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
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </Tooltip>
      </header>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      {!isLoading && tabCount > 0 && (
        <div className="flex-none bg-gray-900/40 border-b border-gray-800/40 px-4 py-1.5 flex items-center gap-3 text-xs overflow-x-auto animate-fade-in">
          <Tooltip
            text={`${stats.domains} site${stats.domains !== 1 ? "s" : ""} open`}
          >
            <span className="flex items-center gap-1.5 text-gray-600 cursor-default whitespace-nowrap select-none">
              <span>🌐</span>
              <span>{stats.domains} sites</span>
            </span>
          </Tooltip>

          {stats.pinned > 0 && (
            <>
              <span className="text-gray-800 select-none">·</span>
              <Tooltip
                text={`${stats.pinned} pinned tab${stats.pinned !== 1 ? "s" : ""}`}
              >
                <span className="flex items-center gap-1 text-yellow-600/80 cursor-default whitespace-nowrap select-none">
                  📌 {stats.pinned} pinned
                </span>
              </Tooltip>
            </>
          )}

          {stats.hibernated > 0 && (
            <>
              <span className="text-gray-800 select-none">·</span>
              <Tooltip
                text={`${stats.hibernated} hibernated tab${stats.hibernated !== 1 ? "s" : ""} — sleeping in background, saving memory`}
              >
                <span className="flex items-center gap-1 text-blue-500/80 cursor-default whitespace-nowrap select-none">
                  💤 {stats.hibernated}
                </span>
              </Tooltip>
            </>
          )}

          {stats.zombies > 0 && (
            <>
              <span className="text-gray-800 select-none">·</span>
              <Tooltip
                text={`${stats.zombies} zombie tab${stats.zombies !== 1 ? "s" : ""} inactive for ${settings.zombieThresholdHours}+ hours — click Zombies button to clean up`}
              >
                <span className="flex items-center gap-1 text-amber-500 cursor-default whitespace-nowrap select-none font-medium">
                  🧟 {stats.zombies} zombies
                </span>
              </Tooltip>
            </>
          )}

          {stats.unvisited > 0 && (
            <>
              <span className="text-gray-800 select-none">·</span>
              <Tooltip
                text={`${stats.unvisited} tab${stats.unvisited !== 1 ? "s" : ""} were opened but never visited`}
              >
                <span className="flex items-center gap-1 text-red-500/80 cursor-default whitespace-nowrap select-none font-medium">
                  👻 {stats.unvisited} unvisited
                </span>
              </Tooltip>
            </>
          )}

          <div className="flex-1" />
          <span className="text-gray-700 hidden sm:flex items-center gap-1 select-none">
            Press <kbd>⌘K</kbd> to search
          </span>
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <LoadingSkeletons />
        ) : tabCount === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {sortedDomains.map((domain, idx) => {
              const domainTabs = tabsByDomain.get(domain)!;
              return (
                <div
                  key={domain}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${Math.min(idx * 20, 180)}ms` }}
                >
                  <DomainGroup domain={domain} tabs={domainTabs} />
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="flex-none bg-gray-900/90 backdrop-blur-md border-t border-gray-800/60 px-4 py-2 flex items-center gap-2 flex-wrap">
        <BulkActions />
        <div className="flex-1" />
        <Tooltip
          text="Save current tabs as a named session to restore later"
          position="top"
          align="end"
        >
          <button
            onClick={() => setShowSessions(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800/60 hover:bg-indigo-900/40 text-gray-400 hover:text-indigo-300 text-xs font-medium transition-all border border-gray-700/40 hover:border-indigo-700/40"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 12h14M12 5l7 7-7 7"
              />
            </svg>
            Sessions
          </button>
        </Tooltip>
      </footer>

      {/* ── Drawers ────────────────────────────────────────────────────── */}
      <SessionManager
        open={showSessions}
        onClose={() => setShowSessions(false)}
      />
      <AnalyticsDashboard
        open={showAnalytics}
        onClose={() => setShowAnalytics(false)}
      />
      <Settings open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

function LoadingSkeletons() {
  return (
    <div className="space-y-3">
      {[4, 3, 2].map((cols, i) => (
        <div
          key={i}
          className="rounded-xl border border-gray-800/60 overflow-hidden"
        >
          <div className="skeleton h-11 w-full" />
          <div
            className={`p-2 grid gap-2`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="skeleton h-[72px]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 animate-fade-in-up">
      <div className="text-6xl mb-4 opacity-60">✨</div>
      <p className="text-lg font-semibold text-gray-400">Clean slate!</p>
      <p className="text-sm text-gray-600 mt-1">No open tabs right now.</p>
    </div>
  );
}
