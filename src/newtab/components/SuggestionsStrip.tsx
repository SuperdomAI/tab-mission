import { useEffect, useRef, useState } from "react";
import { useTabStore } from "../../store/tabStore";
import { useSuggestions } from "../hooks/useSuggestions";
import { ensureOllamaPermission } from "../../lib/ollama";
import { tabSetSignature } from "../../lib/ai/signatures";
import {
  generateSuggestions,
  type Suggestions,
} from "../../lib/ai/suggestions";

interface SuggestionsStripProps {
  /** Open FocusProposal pre-filled with the suggested goal (App owns it). */
  onFocus: (goal: string) => void;
}

const DEBOUNCE_MS = 3000;

/**
 * F3 — the quiet "AI suggests" strip on the Stacks view. After a 3 s debounce
 * it reuses a fresh cached plan for the current tab set (or one that churned
 * by < 5 tabs), otherwise asks the fast model for at most 2 goal groups and
 * shows them as chips. Clicking a chip opens the existing FocusProposal
 * pre-filled with that goal — zero new destructive machinery. ✕ dismisses
 * until the next generation (tab set changed ≥ 5). Hides entirely when AI is
 * off, under 8 tabs, or on error — proactive, never interrupting.
 */
export default function SuggestionsStrip({ onFocus }: SuggestionsStripProps) {
  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const { getFresh, save, dismiss } = useSuggestions();

  const [plan, setPlan] = useState<Suggestions | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const generatingRef = useRef(false);

  const aiOn = settings.ollamaEnabled && settings.aiSuggestions;

  useEffect(() => {
    if (!aiOn || tabs.length < 8) {
      setPlan(null);
      return;
    }
    const id = setTimeout(async () => {
      const sig = tabSetSignature(tabs);
      const fresh = getFresh(sig, settings.aiFastModel, tabs.length);
      if (fresh) {
        setPlan(fresh);
        setStatus("idle");
        return;
      }
      if (generatingRef.current) return;
      generatingRef.current = true;
      setStatus("loading");
      try {
        const granted = await ensureOllamaPermission();
        if (!granted) throw new Error("Permission to reach localhost was denied.");
        const items = await generateSuggestions(tabs, settings.aiFastModel);
        const next: Suggestions = {
          signature: sig,
          items,
          generatedAt: Date.now(),
          model: settings.aiFastModel,
          tabCount: tabs.length,
          dismissed: false,
        };
        await save(next);
        setPlan(next);
        setStatus("idle");
      } catch {
        setStatus("error");
      } finally {
        generatingRef.current = false;
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [tabs, aiOn, getFresh, save, settings.aiFastModel]);

  if (!plan || plan.dismissed || status === "error") return null;

  return (
    <div className="mb-4 flex items-center gap-3 bg-white/[0.03] border border-border rounded-[10px] px-3.5 py-2 w-fit">
      <span className="label-mono">AI suggests</span>
      {plan.items.map((s) => (
        <button
          key={s.goal}
          onClick={() => onFocus(s.goal)}
          title={s.reason}
          className="text-[12px] text-accent font-medium hover:brightness-110 transition-all"
        >
          {s.goal} · {s.tabIds.length} tab{s.tabIds.length !== 1 ? "s" : ""}
        </button>
      ))}
      <button
        onClick={() => void dismiss(plan)}
        aria-label="Dismiss suggestions"
        className="text-[11px] text-faint hover:text-ink px-1"
      >
        ✕
      </button>
    </div>
  );
}