import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTabStore } from "../../store/tabStore";
import Overlay from "./Overlay";
import Favicon from "./Favicon";
import { useTabActions } from "../hooks/useTabActions";
import { useTriagePlan } from "../hooks/useTriagePlan";
import { ensureOllamaPermission } from "../../lib/ollama";
import { tabSetSignature } from "../../lib/ai/signatures";
import {
  generateTriage,
  triageCandidates,
  type TriageAction,
  type TriageCategory,
  type TriageItem,
  type TriagePlan,
} from "../../lib/ai/triage";
import type { EnrichedTab } from "../../types/index";

interface TriageProposalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<TriageCategory, string> = {
  duplicate: "Duplicate",
  "same-thread": "Same thread",
  stale: "Stale",
  unvisited: "Unvisited",
  junk: "Junk",
};

const CATEGORY_ORDER: TriageCategory[] = [
  "duplicate",
  "same-thread",
  "stale",
  "unvisited",
  "junk",
];

/**
 * F2 — "AI triage": a two-column close/keep review of a fast-model triage
 * plan (same grammar as FocusProposal — nothing closes until confirmed).
 * Reuses a fresh cached plan for the current tab set (signature + model +
 * per-source TTL), otherwise generates one on demand. Approve snapshots the
 * closes into a session FIRST (`saveAndClose`), keeping the action reversible.
 */
export default function TriageProposal({ open, onClose }: TriageProposalProps) {
  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const { saveAndClose } = useTabActions();
  const triage = useTriagePlan();

  const [plan, setPlan] = useState<TriagePlan | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState<Map<number, TriageAction>>(new Map());
  const [busy, setBusy] = useState(false);
  const generatingRef = useRef(false);

  const candidates = useMemo(
    () => triageCandidates(tabs, settings),
    [tabs, settings],
  );
  const tabById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);

  const aiOn = settings.ollamaEnabled && settings.aiTriage;

  async function generate(sig: string) {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setStatus("loading");
    setError("");
    try {
      const granted = await ensureOllamaPermission();
      if (!granted) throw new Error("Permission to reach localhost was denied.");
      const items = await generateTriage(candidates, settings.aiFastModel);
      const next: TriagePlan = {
        signature: sig,
        items,
        generatedAt: Date.now(),
        source: "on-demand",
        model: settings.aiFastModel,
      };
      await triage.save(next);
      setPlan(next);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      generatingRef.current = false;
    }
  }

  // Fresh plan for the current tab set → reuse it, else generate. Deps
  // [open] only: reopening must restart from a clean slate, and the overlay
  // is modal so tabs/settings are stable while it is open.
  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setOverrides(new Map());
    setStatus("idle");
    setError("");
    if (!aiOn || candidates.length === 0) return;
    const sig = tabSetSignature(candidates);
    const fresh = triage.getFresh(sig, settings.aiFastModel);
    if (fresh) {
      setPlan(fresh);
      return;
    }
    void generate(sig);
  }, [open]);

  const eff = (item: TriageItem): TriageAction =>
    overrides.get(item.tabId) ?? item.action;

  const closeItems = plan?.items.filter((i) => eff(i) === "close") ?? [];
  const keepItems = plan?.items.filter((i) => eff(i) === "keep") ?? [];

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: closeItems.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);

  function toggle(item: TriageItem) {
    setOverrides((prev) => {
      const current = prev.get(item.tabId) ?? item.action;
      const next = new Map(prev);
      next.set(item.tabId, current === "close" ? "keep" : "close");
      return next;
    });
  }

  async function approve() {
    if (!plan) return;
    setBusy(true);
    try {
      const closeTabs = closeItems
        .map((i) => tabById.get(i.tabId))
        .filter((t): t is EnrichedTab => !!t && !t.isPinned);
      if (closeTabs.length === 0) return;
      // Session-first, reversible — same path as "Clear forgotten".
      await saveAndClose(
        `AI triage — ${new Date().toLocaleDateString()}`,
        closeTabs,
      );
      await triage.clear(); // consumed — also clears the idle-draft notice
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay open={open} onClose={onClose} labelledBy="triage-title">
      <div className="w-[640px] max-w-[94vw] bg-popover border border-border rounded-[14px] overflow-hidden shadow-[0_40px_100px_-30px_#000]">
        <div className="px-6 py-5 border-b border-hairline">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="label-mono mb-1">AI Triage</div>
              <div id="triage-title" className="text-[17px] font-semibold text-ink">
                Cleanup plan
              </div>
            </div>
            {plan?.source === "idle" && (
              <div className="label-mono pt-1">Drafted while you were away</div>
            )}
          </div>
          <div className="text-[12px] text-muted mt-1">
            Close {closeItems.length} · keep {keepItems.length}. Nothing closes
            until you confirm.
          </div>
        </div>

        {plan ? (
          <div className="grid grid-cols-2 max-h-[46vh]">
            <Column
              title={`Close ${closeItems.length}`}
              tone="close"
              rows={grouped.map((g) => (
                <div key={g.category}>
                  <div className="label-mono px-5 pt-3 pb-1">
                    {CATEGORY_LABELS[g.category]} · {g.items.length}
                  </div>
                  {g.items.map((item) => (
                    <Row
                      key={item.tabId}
                      item={item}
                      tab={tabById.get(item.tabId)}
                      effAction={eff(item)}
                      onToggle={() => toggle(item)}
                    />
                  ))}
                </div>
              ))}
              emptyLabel={closeItems.length === 0 ? "None" : undefined}
            />
            <Column
              title={`Keep ${keepItems.length}`}
              tone="keep"
              rows={keepItems.map((item) => (
                <Row
                  key={item.tabId}
                  item={item}
                  tab={tabById.get(item.tabId)}
                  effAction={eff(item)}
                  onToggle={() => toggle(item)}
                />
              ))}
              emptyLabel={keepItems.length === 0 ? "None" : undefined}
            />
          </div>
        ) : status === "error" ? (
          <div className="h-40 grid place-items-center">
            <p className="text-[12px] text-status-unvisited">
              AI unavailable — {error}
            </p>
          </div>
        ) : (
          <div className="h-40 grid place-items-center">
            <p className="text-[12px] text-faint">
              {!aiOn
                ? "Local AI is off — enable it in Settings."
                : candidates.length === 0
                  ? "Nothing to triage right now."
                  : "Thinking…"}
            </p>
          </div>
        )}

        {/* controls */}
        <div className="px-6 py-4 border-t border-hairline flex items-center gap-4">
          {aiOn && plan === null && status !== "idle" && (
            <button
              onClick={() => generate(tabSetSignature(candidates))}
              disabled={status === "loading"}
              className="text-[12px] text-muted bg-white/[0.04] border border-border rounded-[9px] px-3 py-2 hover:text-ink transition-colors disabled:opacity-50"
            >
              {status === "loading" ? "Thinking…" : "AI unavailable — retry"}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-[12px] text-muted px-3 py-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={approve}
            disabled={busy || closeItems.length === 0}
            className="text-[12px] text-white bg-accent border border-accent rounded-[9px] px-3.5 py-2 disabled:opacity-40 hover:brightness-110 transition-all"
          >
            Close {closeItems.length} tab{closeItems.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Column({
  title,
  tone,
  rows,
  emptyLabel,
}: {
  title: string;
  tone: "close" | "keep";
  rows: ReactNode[];
  emptyLabel?: string;
}) {
  return (
    <div
      className={`overflow-y-auto ${
        tone === "close" ? "border-r border-hairline" : "opacity-80"
      }`}
    >
      <div className="label-mono px-5 pt-4 pb-2 sticky top-0 bg-popover">
        {title}
      </div>
      {rows.length === 0 && emptyLabel && (
        <div className="px-5 py-3 text-[12px] text-faint">{emptyLabel}</div>
      )}
      {rows}
    </div>
  );
}

function Row({
  item,
  tab,
  effAction,
  onToggle,
}: {
  item: TriageItem;
  tab: EnrichedTab | undefined;
  effAction: TriageAction;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-2">
      {tab && <Favicon tab={tab} size={16} rounded={4} />}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-ink truncate">
          {tab?.title || `Tab ${item.tabId}`}
        </div>
        <div className="text-[11px] text-faint truncate">{item.reason}</div>
      </div>
      <button
        onClick={onToggle}
        className="shrink-0 text-[11px] text-muted border border-border rounded-[7px] px-2 py-0.5 hover:text-ink hover:border-hairline transition-colors"
      >
        {effAction === "close" ? "Keep" : "Close"}
      </button>
    </div>
  );
}