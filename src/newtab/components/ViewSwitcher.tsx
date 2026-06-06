import { useEffect } from "react";
import { useTabStore, type ViewMode } from "../../store/tabStore";

const VIEWS: { mode: ViewMode; label: string; key: string }[] = [
  { mode: "stacks", label: "Stacks", key: "⌘1" },
  { mode: "timeline", label: "Timeline", key: "⌘2" },
];

/** Segmented Stacks/Timeline control. ⌘1 / ⌘2 switch; choice persists. */
export default function ViewSwitcher() {
  const viewMode = useTabStore((s) => s.viewMode);
  const setViewMode = useTabStore((s) => s.setViewMode);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "1") {
        e.preventDefault();
        setViewMode("stacks");
      } else if (e.key === "2") {
        e.preventDefault();
        setViewMode("timeline");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setViewMode]);

  return (
    <div
      role="tablist"
      aria-label="View"
      className="flex gap-1 bg-white/[0.05] border border-hairline rounded-[10px] p-[3px]"
    >
      {VIEWS.map((v) => (
        <button
          key={v.mode}
          role="tab"
          aria-selected={viewMode === v.mode}
          onClick={() => setViewMode(v.mode)}
          className={`font-mono text-[11px] px-2.5 py-1.5 rounded-[7px] transition-colors ${
            viewMode === v.mode
              ? "bg-white/[0.08] text-ink"
              : "text-faint hover:text-muted"
          }`}
          title={v.key}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
