import { useState } from "react";
import type { EnrichedTab } from "../../types/index";
import Overlay from "./Overlay";
import Favicon from "./Favicon";
import TabRow from "./TabRow";
import { useTabActions, persistSession } from "../hooks/useTabActions";

interface DeckPopoverProps {
  domain: string;
  tabs: EnrichedTab[];
  open: boolean;
  onClose: () => void;
}

/** Click a deck → this popover lists the site's tabs with per-tab + bulk close. */
export default function DeckPopover({ domain, tabs, open, onClose }: DeckPopoverProps) {
  const { close, closeMany, hibernateMany, jumpTo } = useTabActions();
  const [saved, setSaved] = useState(false);

  const closeable = tabs.filter((t) => !t.isPinned);
  const unvisited = tabs.filter((t) => t.visitCount === 0).length;
  const headerId = "deck-popover-title";

  async function saveAsSession() {
    await persistSession(`${domain} — ${new Date().toLocaleDateString()}`, tabs);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Overlay open={open} onClose={onClose} labelledBy={headerId}>
      <div className="w-[480px] max-w-[92vw] bg-popover border border-border rounded-[14px] overflow-hidden shadow-[0_40px_100px_-30px_#000]">
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-hairline">
          <Favicon tab={{ url: tabs[0]?.url ?? "", domain, title: domain }} size={34} rounded={10} />
          <div className="min-w-0">
            <div id={headerId} className="text-[15px] font-semibold text-ink truncate">{domain}</div>
            <div className="font-mono text-[11px] text-faint">
              {tabs.length} tab{tabs.length !== 1 ? "s" : ""}
              {unvisited > 0 && ` · ${unvisited} never visited`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close popover"
            className="ml-auto w-7 h-7 grid place-items-center rounded-[7px] text-faint border border-border hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* tab list */}
        <div className="max-h-[50vh] overflow-y-auto">
          {tabs.map((tab) => (
            <TabRow key={tab.id} tab={tab} onJump={jumpTo} onClose={close} />
          ))}
        </div>

        {/* footer */}
        <div className="flex items-center gap-2 px-5 py-3.5 bg-white/[0.02] border-t border-hairline">
          <button
            onClick={() => hibernateMany(tabs)}
            className="text-[12px] text-muted bg-white/[0.04] border border-border rounded-[9px] px-3 py-2 hover:text-ink transition-colors"
          >
            Hibernate all
          </button>
          <button
            onClick={saveAsSession}
            className="text-[12px] text-muted bg-white/[0.04] border border-border rounded-[9px] px-3 py-2 hover:text-ink transition-colors"
          >
            {saved ? "✓ Saved" : "Save as session"}
          </button>
          <div className="flex-1" />
          <button
            onClick={async () => {
              await closeMany(closeable.map((t) => t.id));
              onClose();
            }}
            disabled={closeable.length === 0}
            className="text-[12px] text-white bg-accent border border-accent rounded-[9px] px-3 py-2 disabled:opacity-40 hover:brightness-110 transition-all"
          >
            Close {closeable.length} tab{closeable.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
