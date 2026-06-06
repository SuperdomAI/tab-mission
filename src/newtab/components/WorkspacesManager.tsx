import { format } from "date-fns";
import Overlay from "./Overlay";
import { useWorkspaces } from "../hooks/useWorkspaces";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Drawer listing saved Workspaces (goal-driven set-asides) with restore/delete. */
export default function WorkspacesManager({ open, onClose }: Props) {
  const { workspaces, restore, remove } = useWorkspaces();

  return (
    <Overlay open={open} onClose={onClose} placement="right" labelledBy="ws-title">
      <aside className="h-full w-[360px] max-w-[92vw] bg-popover border-l border-border flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <h2 id="ws-title" className="font-semibold text-ink text-[15px]">Workspaces</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 grid place-items-center rounded-[7px] text-faint hover:text-ink border border-border">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {workspaces.length === 0 ? (
            <div className="text-center py-14">
              <p className="text-sm text-muted">No workspaces yet.</p>
              <p className="text-[12px] text-faint mt-1">
                Press <kbd>⌘K</kbd> and type a goal to set tabs aside into a workspace.
              </p>
            </div>
          ) : (
            [...workspaces].reverse().map((ws) => (
              <div key={ws.id} className="bg-surface rounded-[12px] p-3.5 border border-hairline">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{ws.goal || "Untitled"}</p>
                    <p className="font-mono text-[10px] text-faint mt-0.5">
                      {format(ws.createdAt, "MMM d · h:mm a")}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-faint shrink-0">
                    {ws.tabs.length} tab{ws.tabs.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => restore(ws.id)}
                    className="flex-1 text-[12px] text-white bg-accent border border-accent rounded-[8px] px-3 py-1.5 hover:brightness-110 transition-all"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => remove(ws.id)}
                    aria-label="Delete workspace"
                    className="text-[12px] text-faint bg-white/[0.04] border border-border rounded-[8px] px-2.5 py-1.5 hover:text-[var(--status-unvisited)] transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </Overlay>
  );
}
