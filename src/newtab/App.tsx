import { useState, useEffect } from "react";
import { useTabs } from "./hooks/useTabs";
import { useTabStore, useShallow } from "../store/tabStore";
import { useWorkspaces } from "./hooks/useWorkspaces";
import CommandPalette from "./components/CommandPalette";
import ViewSwitcher from "./components/ViewSwitcher";
import StacksView from "./components/StacksView";
import TimelineView from "./components/TimelineView";
import FocusProposal from "./components/FocusProposal";
import WorkspacesManager from "./components/WorkspacesManager";
import AskAI from "./components/AskAI";
import SessionManager from "./components/SessionManager";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import Settings from "./components/Settings";
import Tooltip from "./components/Tooltip";
import superdomLogo from "../assets/superdom-logo.svg";

// Swap this one-liner anytime — it shows in the footer next to the credit.
const FOOTER_TAGLINE = "Rescuing your RAM, one tab at a time.";

export default function App() {
  useTabs();

  const { tabs, isLoading, settings, viewMode } = useTabStore(
    useShallow((s) => ({
      tabs: s.tabs,
      isLoading: s.isLoading,
      settings: s.settings,
      viewMode: s.viewMode,
    })),
  );

  const [showSessions, setShowSessions] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [showAskAI, setShowAskAI] = useState(false);
  const [focusGoal, setFocusGoal] = useState<string | null>(null);
  const [toast, setToast] = useState<{ count: number } | null>(null);

  const { undoLast } = useWorkspaces();

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  const tabCount = tabs.length;
  const windows = new Set(tabs.map((t) => t.windowId)).size;
  const overLimit = tabCount >= settings.tabLimitWarning;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex-none flex items-center gap-4 px-9 pt-9 pb-3">
        <span className="font-mono font-semibold text-[13px] tracking-[0.14em] uppercase text-ink select-none">
          Mission<span className="text-accent">·</span>Control
        </span>
        <span
          className={`font-mono text-[12px] ${overLimit ? "text-[var(--status-unvisited)]" : "text-muted"}`}
          title={overLimit ? `Over your ${settings.tabLimitWarning}-tab limit` : undefined}
        >
          {tabCount} tab{tabCount !== 1 ? "s" : ""} · {windows} window{windows !== 1 ? "s" : ""}
        </span>
        <div className="flex-1" />
        <ViewSwitcher />
        <Tooltip text="Analytics">
          <button
            onClick={() => setShowAnalytics(true)}
            aria-label="Analytics"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-faint hover:text-ink hover:bg-white/[0.05] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip text="Settings">
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            className="w-8 h-8 grid place-items-center rounded-[8px] text-faint hover:text-ink hover:bg-white/[0.05] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </Tooltip>
      </header>

      {/* ── Command palette (⌘K) ───────────────────────────────────── */}
      <CommandPalette
        onFocus={(goal) => setFocusGoal(goal)}
        onOpenWorkspaces={() => setShowWorkspaces(true)}
        onAskAI={() => setShowAskAI(true)}
      />

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="flex-1 px-9 py-4">
        {isLoading ? (
          <LoadingSkeletons />
        ) : tabCount === 0 ? (
          <EmptyState />
        ) : viewMode === "stacks" ? (
          <StacksView />
        ) : (
          <TimelineView />
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="flex-none flex items-center gap-3 px-9 py-3.5 border-t border-hairline">
        <span className="font-mono text-[11px] text-faint select-none">
          Press <kbd>⌘K</kbd> for commands
        </span>
        <span className="hidden lg:inline text-[12px] text-faint select-none">
          {FOOTER_TAGLINE}
        </span>
        <a
          href="https://superdom.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-accent transition-colors"
        >
          <img
            src={superdomLogo}
            alt=""
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
          />
          Built by SuperdomAI ↗
        </a>
        <div className="flex-1" />
        <button
          onClick={() => setShowWorkspaces(true)}
          className="text-[12px] text-muted bg-white/[0.04] border border-border rounded-[9px] px-3 py-2 hover:text-ink transition-colors"
        >
          Workspaces
        </button>
        <button
          onClick={() => setShowSessions(true)}
          className="ml-2 text-[12px] text-muted bg-white/[0.04] border border-border rounded-[9px] px-3 py-2 hover:text-ink transition-colors"
        >
          Sessions
        </button>
      </footer>

      {/* ── Focus + Workspaces ─────────────────────────────────────── */}
      <FocusProposal
        open={focusGoal !== null}
        goal={focusGoal ?? ""}
        onClose={() => setFocusGoal(null)}
        onDone={(count) => count > 0 && setToast({ count })}
      />
      <WorkspacesManager open={showWorkspaces} onClose={() => setShowWorkspaces(false)} />
      <AskAI open={showAskAI} onClose={() => setShowAskAI(false)} />

      {/* ── Undo toast ─────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-popover border border-border rounded-[12px] px-4 py-3 shadow-[0_24px_60px_-20px_#000] animate-fade-in-up">
          <span className="text-[13px] text-ink">
            Set aside {toast.count} tab{toast.count !== 1 ? "s" : ""}
          </span>
          <button
            onClick={async () => {
              await undoLast();
              setToast(null);
            }}
            className="text-[12px] text-accent font-medium hover:brightness-110"
          >
            Undo
          </button>
        </div>
      )}

      {/* ── Drawers ────────────────────────────────────────────────── */}
      <SessionManager open={showSessions} onClose={() => setShowSessions(false)} />
      <AnalyticsDashboard open={showAnalytics} onClose={() => setShowAnalytics(false)} />
      <Settings open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

function LoadingSkeletons() {
  return (
    <>
      <div className="label-mono mb-4 px-1">Your stacks</div>
      <div className="grid gap-[22px_18px] [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-[136px]" />
        ))}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 animate-fade-in-up">
      <p className="text-lg font-semibold text-muted">Clean slate.</p>
      <p className="text-sm text-faint mt-1">No open tabs right now.</p>
    </div>
  );
}
