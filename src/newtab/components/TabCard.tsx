import React, { useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import type { EnrichedTab } from "../../types/index";
import Tooltip from "./Tooltip";

interface TabCardProps {
  tab: EnrichedTab;
}

function msToHuman(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function getStatusBorderColor(tab: EnrichedTab): string {
  if (tab.visitCount === 0) return "border-l-red-500/60";
  if (tab.isHibernated) return "border-l-blue-500/40";
  if (tab.lastActiveAt && Date.now() - tab.lastActiveAt < 30 * 60_000) {
    return "border-l-emerald-500/60";
  }
  if (tab.lastActiveAt && Date.now() - tab.lastActiveAt > 2 * 3_600_000) {
    return "border-l-amber-500/40";
  }
  return "border-l-gray-700/60";
}

export default function TabCard({ tab }: TabCardProps) {
  const [, startTransition] = useTransition();

  async function jumpToTab() {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      console.error("[TMC] jumpToTab error:", e);
    }
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    });
  }

  function handleHibernate(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      try {
        await chrome.tabs.discard(tab.id);
      } catch {}
    });
  }

  const lastActiveAgo = tab.lastActiveAt
    ? formatDistanceToNow(tab.lastActiveAt, { addSuffix: true })
    : null;

  return (
    <div
      onClick={jumpToTab}
      className={`tab-card group relative flex flex-col gap-1.5 p-3 rounded-xl cursor-pointer
        bg-gray-900/70 hover:bg-gray-800/90
        border border-l-4 border-gray-800/60 hover:border-gray-700/60
        ${getStatusBorderColor(tab)}
        ${tab.isHibernated ? "opacity-60" : ""}
      `}
    >
      {/* Action buttons — visible on hover */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10">
        {!tab.isHibernated && (
          <Tooltip text="Hibernate — unload from memory, keep in tab bar">
            <button
              onClick={handleHibernate}
              className="w-6 h-6 rounded-md flex items-center justify-center bg-gray-800/90 hover:bg-blue-900/70 text-gray-500 hover:text-blue-400 transition-all"
              aria-label="Hibernate tab"
            >
              <svg
                className="w-3 h-3"
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
            </button>
          </Tooltip>
        )}
        <Tooltip text="Close this tab">
          <button
            onClick={handleClose}
            className="w-6 h-6 rounded-md flex items-center justify-center bg-gray-800/90 hover:bg-red-900/70 text-gray-500 hover:text-red-400 transition-all"
            aria-label="Close tab"
          >
            <svg
              className="w-3 h-3"
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
        </Tooltip>
      </div>

      {/* Title row */}
      <div className="flex items-start gap-2 pr-16">
        {tab.favIconUrl ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className="w-4 h-4 mt-0.5 rounded-sm flex-shrink-0"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="w-4 h-4 mt-0.5 rounded-sm bg-gray-700 flex-shrink-0" />
        )}
        <span className="text-sm text-gray-100 font-medium line-clamp-1 leading-snug flex-1 min-w-0">
          {tab.title || tab.url}
        </span>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {tab.visitCount === 0 ? (
          <Tooltip text="This tab has never been visited">
            <span className="bg-red-900/40 text-red-400 px-1.5 py-0.5 rounded-md font-medium">
              Never visited
            </span>
          </Tooltip>
        ) : lastActiveAgo ? (
          <Tooltip text={`Last visited ${lastActiveAgo}`}>
            <span className="text-gray-600">{lastActiveAgo}</span>
          </Tooltip>
        ) : null}

        {tab.isHibernated && (
          <Tooltip text="Tab is hibernated — unloaded from memory to save RAM">
            <span className="bg-blue-900/30 text-blue-400/80 px-1.5 py-0.5 rounded-md">
              💤 Asleep
            </span>
          </Tooltip>
        )}

        {tab.isPinned && (
          <Tooltip text="Pinned tab">
            <span className="text-yellow-500/70 text-xs">📌</span>
          </Tooltip>
        )}

        {tab.visitCount > 1 && (
          <Tooltip text={`Visited ${tab.visitCount} times`}>
            <span className="text-gray-700">×{tab.visitCount}</span>
          </Tooltip>
        )}

        {tab.totalActiveTime > 0 && (
          <Tooltip text={`${msToHuman(tab.totalActiveTime)} spent in this tab`}>
            <span className="text-gray-700">
              {msToHuman(tab.totalActiveTime)}
            </span>
          </Tooltip>
        )}

        {tab.groupName && (
          <Tooltip text={`Chrome group: ${tab.groupName}`}>
            <span
              className="px-1.5 py-0.5 rounded-md text-xs font-medium"
              style={{
                background: `${tab.groupColor}22`,
                color: tab.groupColor ?? "#94a3b8",
                borderColor: `${tab.groupColor}44`,
              }}
            >
              {tab.groupName}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Tags */}
      {tab.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tab.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs bg-indigo-900/40 text-indigo-400 px-1.5 py-0.5 rounded-md"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
