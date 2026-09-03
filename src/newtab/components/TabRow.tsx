import React, { useState } from "react";
import type { EnrichedTab } from "../../types/index";
import Favicon from "./Favicon";
import StatusDot from "./StatusDot";
import { useTabStore } from "../../store/tabStore";
import { msToHuman, shortAgo } from "../../lib/format";

interface TabRowProps {
  tab: EnrichedTab;
  onJump: (tab: EnrichedTab) => void;
  onClose: (id: number) => void;
  /** F6 — summarize-then-close; shown when provided and the AI gates pass. */
  onSummarizeClose?: (tab: EnrichedTab) => void;
}

/** One tab inside the deck popover / timeline: favicon · title · mono meta · dot · ✕. */
export default function TabRow({ tab, onJump, onClose, onSummarizeClose }: TabRowProps) {
  const settings = useTabStore((s) => s.settings);
  const [summarizing, setSummarizing] = useState(false);
  const ago = shortAgo(tab.lastActiveAt);
  const meta = [
    tab.visitCount > 1 ? `×${tab.visitCount}` : null,
    tab.totalActiveTime > 0 ? msToHuman(tab.totalActiveTime) : null,
    ago || (tab.visitCount === 0 ? "never" : null),
  ]
    .filter(Boolean)
    .join(" · ");

  const canSummarize =
    !!onSummarizeClose &&
    settings.ollamaEnabled &&
    settings.aiPageReadingEnabled &&
    !tab.isPinned;

  async function handleSummarize() {
    if (summarizing) return;
    setSummarizing(true);
    try {
      await onSummarizeClose?.(tab);
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div
      onClick={() => !summarizing && onJump(tab)}
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
      {canSummarize && (
        <button
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            void handleSummarize();
          }}
          aria-label={`Summarize and close ${tab.title || tab.url}`}
          title={summarizing ? "Summarizing…" : "Summarize & close"}
          disabled={summarizing}
          className="w-6 h-6 grid place-items-center rounded-[6px] text-faint border border-transparent opacity-0 group-hover:opacity-100 hover:border-border hover:text-accent disabled:opacity-60 transition-all"
        >
          {summarizing ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          )}
        </button>
      )}
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
