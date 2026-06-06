import React from "react";
import type { EnrichedTab } from "../../types/index";
import Favicon from "./Favicon";
import StatusDot from "./StatusDot";
import { msToHuman, shortAgo } from "../../lib/format";

interface TabRowProps {
  tab: EnrichedTab;
  onJump: (tab: EnrichedTab) => void;
  onClose: (id: number) => void;
}

/** One tab inside the deck popover / timeline: favicon · title · mono meta · dot · ✕. */
export default function TabRow({ tab, onJump, onClose }: TabRowProps) {
  const ago = shortAgo(tab.lastActiveAt);
  const meta = [
    tab.visitCount > 1 ? `×${tab.visitCount}` : null,
    tab.totalActiveTime > 0 ? msToHuman(tab.totalActiveTime) : null,
    ago || (tab.visitCount === 0 ? "never" : null),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      onClick={() => onJump(tab)}
      className="group flex items-center gap-3 px-5 py-3 cursor-pointer border-b border-hairline last:border-0 hover:bg-white/[0.03] transition-colors"
    >
      <Favicon tab={tab} size={18} rounded={5} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink truncate">
          {tab.title || tab.url}
          {tab.isPinned && <span className="text-faint ml-1.5 text-[10px]">pinned</span>}
        </div>
        {meta && <div className="font-mono text-[10px] text-faint mt-0.5">{meta}</div>}
      </div>
      <StatusDot tab={tab} />
      <button
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        aria-label={`Close ${tab.title || tab.url}`}
        className="w-6 h-6 grid place-items-center rounded-[6px] text-faint border border-transparent opacity-0 group-hover:opacity-100 hover:border-border hover:text-[var(--status-unvisited)] transition-all"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
