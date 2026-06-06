import { useMemo } from "react";
import { useTabStore } from "../../store/tabStore";
import { bucketByRecency, clearableForgotten } from "../../lib/bucketByRecency";
import { useTabActions } from "../hooks/useTabActions";
import TabRow from "./TabRow";

/** Second view: tabs by attention over time, with safe "clear forgotten". */
export default function TimelineView() {
  const tabs = useTabStore((s) => s.tabs);
  const { close, jumpTo, saveAndClose } = useTabActions();

  const buckets = useMemo(() => bucketByRecency(tabs), [tabs]);
  const clearable = useMemo(() => clearableForgotten(tabs), [tabs]);

  async function clearForgotten() {
    if (clearable.length === 0) return;
    // saveAndClose persists a session BEFORE closing, and excludes pinned.
    await saveAndClose(
      `Forgotten — ${new Date().toLocaleDateString()}`,
      clearable,
    );
  }

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="label-mono mb-5 px-1">Where your attention has been</div>

      {buckets.map((b) => (
        <section key={b.key} className="relative pl-[132px] mb-7">
          {/* time marker */}
          <div className="absolute left-0 top-0.5 w-[112px] text-right">
            <div className="label-mono">{b.label}</div>
          </div>
          {/* spine node */}
          <div
            className="absolute left-[118px] top-1.5 w-3 h-3 rounded-full bg-bg border-2"
            style={{
              borderColor:
                b.key === "now" ? "var(--status-recent)" : "var(--color-faint)",
            }}
          />
          <div
            className={`rounded-[12px] border border-hairline overflow-hidden ${
              b.key === "forgotten" ? "opacity-55" : ""
            }`}
          >
            {b.tabs.map((tab) => (
              <TabRow key={tab.id} tab={tab} onJump={jumpTo} onClose={close} />
            ))}
          </div>
        </section>
      ))}

      {clearable.length > 0 && (
        <div className="pl-[132px]">
          <button
            onClick={clearForgotten}
            className="inline-flex items-center gap-2 text-[12px] text-[var(--status-unvisited)] bg-white/[0.03] border border-border rounded-[10px] px-3.5 py-2 hover:bg-white/[0.06] transition-colors"
          >
            ⌫ Clear {clearable.length} forgotten tab
            {clearable.length !== 1 ? "s" : ""} · saved to a session first
          </button>
        </div>
      )}

      {buckets.length === 0 && (
        <div className="text-center text-muted py-16">No open tabs.</div>
      )}
    </div>
  );
}
