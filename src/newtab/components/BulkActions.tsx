import React, { useState, useTransition, useMemo } from "react";
import { useTabStore } from "../../store/tabStore";
import Tooltip from "./Tooltip";

export default function BulkActions() {
  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  function showStatus(text: string, ok = true) {
    setStatus({ text, ok });
    setTimeout(() => setStatus(null), 3000);
  }

  const counts = useMemo(() => {
    const urlsSeen = new Set<string>();
    let dupes = 0;
    for (const tab of tabs) {
      if (urlsSeen.has(tab.url)) dupes++;
      else urlsSeen.add(tab.url);
    }
    const unvisited = tabs.filter(
      (t) => t.visitCount === 0 && t.openedAt < Date.now() - 30 * 60_000,
    ).length;
    const zombieThresh = Date.now() - settings.zombieThresholdHours * 3_600_000;
    const zombies = tabs.filter(
      (t) => t.lastActiveAt === null || t.lastActiveAt < zombieThresh,
    ).length;
    const active = tabs.filter((t) => !t.isHibernated).length;
    return { dupes, unvisited, zombies, active };
  }, [tabs, settings.zombieThresholdHours]);

  async function closeDuplicates() {
    const seen = new Map<string, { id: number; lastActiveAt: number | null }>();
    let closed = 0;
    for (const tab of tabs) {
      const existing = seen.get(tab.url);
      if (!existing) {
        seen.set(tab.url, { id: tab.id, lastActiveAt: tab.lastActiveAt });
      } else {
        const keepCurrent =
          (tab.lastActiveAt ?? 0) > (existing.lastActiveAt ?? 0);
        const closeId = keepCurrent ? existing.id : tab.id;
        try {
          await chrome.tabs.remove(closeId);
          closed++;
        } catch {}
        if (keepCurrent)
          seen.set(tab.url, { id: tab.id, lastActiveAt: tab.lastActiveAt });
      }
    }
    showStatus(`Closed ${closed} duplicate${closed !== 1 ? "s" : ""}`);
  }

  async function closeUnvisited() {
    const threshold = Date.now() - 30 * 60_000;
    const toClose = tabs.filter(
      (t) => t.visitCount === 0 && t.openedAt < threshold,
    );
    for (const tab of toClose) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    }
    showStatus(
      `Closed ${toClose.length} unvisited tab${toClose.length !== 1 ? "s" : ""}`,
    );
  }

  async function closeZombies() {
    const threshold = Date.now() - settings.zombieThresholdHours * 3_600_000;
    const toClose = tabs.filter(
      (t) => t.lastActiveAt === null || t.lastActiveAt < threshold,
    );
    for (const tab of toClose) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    }
    showStatus(
      `Closed ${toClose.length} zombie tab${toClose.length !== 1 ? "s" : ""}`,
    );
  }

  async function hibernateAll() {
    let count = 0;
    for (const tab of tabs) {
      if (!tab.isHibernated) {
        try {
          await chrome.tabs.discard(tab.id);
          count++;
        } catch {}
      }
    }
    showStatus(`Hibernated ${count} tab${count !== 1 ? "s" : ""}`);
  }

  const btn =
    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-35 disabled:cursor-not-allowed border";

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {status && (
        <span
          className={`text-xs px-2.5 py-1 rounded-lg animate-fade-in ${
            status.ok
              ? "bg-emerald-900/30 text-emerald-400 border border-emerald-800/40"
              : "bg-red-900/30 text-red-400 border border-red-800/40"
          }`}
        >
          {status.ok ? "✓" : "✗"} {status.text}
        </span>
      )}

      <Tooltip
        text={
          counts.dupes > 0
            ? `Close ${counts.dupes} duplicate URL${counts.dupes !== 1 ? "s" : ""}, keeping the most recently active`
            : "No duplicate tabs found"
        }
      >
        <button
          onClick={() => startTransition(closeDuplicates)}
          disabled={isPending || counts.dupes === 0}
          className={`${btn} bg-gray-800/60 border-gray-700/40 text-gray-400 hover:bg-orange-900/30 hover:text-orange-300 hover:border-orange-800/40`}
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
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          Dupes
          {counts.dupes > 0 && (
            <span className="bg-orange-800/50 text-orange-300 px-1 py-px rounded text-xs tabular-nums">
              {counts.dupes}
            </span>
          )}
        </button>
      </Tooltip>

      <Tooltip
        text={
          counts.unvisited > 0
            ? `Close ${counts.unvisited} tab${counts.unvisited !== 1 ? "s" : ""} opened 30+ min ago but never visited`
            : "No unvisited tabs to close"
        }
      >
        <button
          onClick={() => startTransition(closeUnvisited)}
          disabled={isPending || counts.unvisited === 0}
          className={`${btn} bg-gray-800/60 border-gray-700/40 text-gray-400 hover:bg-red-900/30 hover:text-red-300 hover:border-red-800/40`}
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
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
            />
          </svg>
          Unvisited
          {counts.unvisited > 0 && (
            <span className="bg-red-800/50 text-red-300 px-1 py-px rounded text-xs tabular-nums">
              {counts.unvisited}
            </span>
          )}
        </button>
      </Tooltip>

      <Tooltip
        text={
          counts.zombies > 0
            ? `Close ${counts.zombies} zombie tab${counts.zombies !== 1 ? "s" : ""} inactive for ${settings.zombieThresholdHours}+ hours`
            : `No zombie tabs (inactive for ${settings.zombieThresholdHours}+ hours) found`
        }
      >
        <button
          onClick={() => startTransition(closeZombies)}
          disabled={isPending || counts.zombies === 0}
          className={`${btn} bg-gray-800/60 border-gray-700/40 text-gray-400 hover:bg-red-900/30 hover:text-red-300 hover:border-red-800/40`}
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
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Zombies
          {counts.zombies > 0 && (
            <span className="bg-red-800/50 text-red-300 px-1 py-px rounded text-xs tabular-nums">
              {counts.zombies}
            </span>
          )}
        </button>
      </Tooltip>

      <Tooltip
        text={`Unload ${counts.active} background tab${counts.active !== 1 ? "s" : ""} from memory — they stay in your tab bar`}
      >
        <button
          onClick={() => startTransition(hibernateAll)}
          disabled={isPending || counts.active === 0}
          className={`${btn} bg-gray-800/60 border-gray-700/40 text-gray-400 hover:bg-blue-900/30 hover:text-blue-300 hover:border-blue-800/40`}
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
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
            />
          </svg>
          Hibernate all
        </button>
      </Tooltip>
    </div>
  );
}
