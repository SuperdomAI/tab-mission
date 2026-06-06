import { useState, useMemo, useEffect } from "react";
import { useTabStore } from "../../store/tabStore";
import Overlay from "./Overlay";
import Favicon from "./Favicon";
import { useWorkspaces } from "../hooks/useWorkspaces";
import { scoreTabs } from "../../lib/relevance";
import {
  ensureOllamaPermission,
  classifyRelevant,
  detectOllama,
} from "../../lib/ollama";
import type { EnrichedTab } from "../../types/index";

interface FocusProposalProps {
  open: boolean;
  goal: string;
  onClose: () => void;
  onDone: (count: number) => void;
}

/**
 * "Focus on <goal>" review: heuristic keep/set-aside proposal the user confirms
 * before anything closes. Optional "Refine with AI" uses local Ollama.
 */
export default function FocusProposal({ open, goal, onClose, onDone }: FocusProposalProps) {
  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const { focus } = useWorkspaces();

  const [strictness, setStrictness] = useState(0.5);
  const [aiKeep, setAiKeep] = useState<Set<number> | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAiKeep(null);
      setAiState("idle");
      setStrictness(0.5);
    }
  }, [open, goal]);

  const split = useMemo(() => {
    if (aiKeep) {
      return {
        keep: tabs.filter((t) => t.isPinned || aiKeep.has(t.id)),
        stash: tabs.filter((t) => !t.isPinned && !aiKeep.has(t.id)),
      };
    }
    return scoreTabs(tabs, goal, strictness);
  }, [tabs, goal, strictness, aiKeep]);

  async function refineWithAI() {
    setAiState("loading");
    try {
      const granted = await ensureOllamaPermission();
      if (!granted) throw new Error("permission");
      if (!(await detectOllama())) throw new Error("offline");
      const ids = await classifyRelevant(
        goal,
        tabs.map((t) => ({ id: t.id, title: t.title, domain: t.domain })),
        settings.ollamaModel,
      );
      setAiKeep(new Set(ids));
      setAiState("idle");
    } catch {
      setAiState("error");
    }
  }

  async function confirm() {
    setBusy(true);
    const count = split.stash.filter((t) => !t.isPinned).length;
    await focus(goal, split.stash);
    setBusy(false);
    onClose();
    onDone(count);
  }

  const stashCount = split.stash.filter((t) => !t.isPinned).length;

  return (
    <Overlay open={open} onClose={onClose} labelledBy="focus-title">
      <div className="w-[640px] max-w-[94vw] bg-popover border border-border rounded-[14px] overflow-hidden shadow-[0_40px_100px_-30px_#000]">
        <div className="px-6 py-5 border-b border-hairline">
          <div className="label-mono mb-1">Focus</div>
          <div id="focus-title" className="text-[17px] font-semibold text-ink">
            “{goal}”
          </div>
          <div className="text-[12px] text-muted mt-1">
            Keep {split.keep.length} · set aside {stashCount}. Nothing closes until you confirm.
          </div>
        </div>

        <div className="grid grid-cols-2 max-h-[46vh]">
          <Column title={`Keep ${split.keep.length}`} tabs={split.keep} tone="keep" />
          <Column title={`Set aside ${stashCount}`} tabs={split.stash.filter((t) => !t.isPinned)} tone="stash" />
        </div>

        {/* controls */}
        <div className="px-6 py-4 border-t border-hairline flex items-center gap-4">
          {!aiKeep && (
            <label className="flex items-center gap-2.5 text-[12px] text-muted">
              <span className="label-mono">Loose</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={strictness}
                onChange={(e) => setStrictness(Number(e.target.value))}
                className="accent-[var(--accent)]"
              />
              <span className="label-mono">Strict</span>
            </label>
          )}
          {settings.ollamaEnabled && (
            <button
              onClick={refineWithAI}
              disabled={aiState === "loading"}
              className="text-[12px] text-muted bg-white/[0.04] border border-border rounded-[9px] px-3 py-2 hover:text-ink transition-colors disabled:opacity-50"
            >
              {aiState === "loading"
                ? "Thinking…"
                : aiState === "error"
                  ? "AI unavailable — retry"
                  : aiKeep
                    ? "✓ AI refined"
                    : "Refine with AI"}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-[12px] text-muted px-3 py-2 hover:text-ink">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy || stashCount === 0}
            className="text-[12px] text-white bg-accent border border-accent rounded-[9px] px-3.5 py-2 disabled:opacity-40 hover:brightness-110 transition-all"
          >
            Set aside {stashCount} tab{stashCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Column({ title, tabs, tone }: { title: string; tabs: EnrichedTab[]; tone: "keep" | "stash" }) {
  return (
    <div className={`overflow-y-auto ${tone === "keep" ? "border-r border-hairline" : "opacity-80"}`}>
      <div className="label-mono px-5 pt-4 pb-2 sticky top-0 bg-popover">{title}</div>
      {tabs.length === 0 && <div className="px-5 py-3 text-[12px] text-faint">None</div>}
      {tabs.map((t) => (
        <div key={t.id} className="flex items-center gap-2.5 px-5 py-2">
          <Favicon tab={t} size={16} rounded={4} />
          <span className="text-[12px] text-ink truncate">{t.title || t.url}</span>
        </div>
      ))}
    </div>
  );
}
