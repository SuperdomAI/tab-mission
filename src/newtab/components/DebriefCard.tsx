import { useEffect, useMemo, useRef, useState } from "react";
import { useTabStore } from "../../store/tabStore";
import {
  useAnalyticsStore,
  todayAnalytics,
  topDomains,
} from "../../store/analyticsStore";
import { useAIReports } from "../hooks/useAIReports";
import {
  debriefInputFromDay,
  debriefReportId,
  generateDebrief,
  type DebriefReport,
} from "../../lib/ai/reports";
import { ensureOllamaPermission } from "../../lib/ollama";

/**
 * F1 — "Today's debrief": a short, honest evening report from the local chat
 * model. Generated on demand and auto-regenerated when the Analytics drawer
 * opens and today's report is missing or stale (TTL 6 h). Hidden entirely
 * when Ollama is off or the `aiDebrief` toggle is off — the product stays
 * complete without AI.
 */
export default function DebriefCard({ open }: { open: boolean }) {
  const settings = useTabStore((s) => s.settings);
  const analytics = useAnalyticsStore((s) => s.analytics);
  const { getEntry, save } = useAIReports();
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState("");
  const generatingRef = useRef(false);

  const input = useMemo(() => {
    const today = todayAnalytics(analytics);
    const topFive = today ? topDomains(today.domainTime, 5) : [];
    return debriefInputFromDay(today, topFive.map((t) => t.domain));
  }, [analytics]);

  const id = debriefReportId(new Date().toISOString().slice(0, 10));
  const entry = getEntry<DebriefReport>(id, settings.aiChatModel, "debrief");
  const report = entry?.result;

  async function generate() {
    if (generatingRef.current || !input) return;
    generatingRef.current = true;
    setStatus("generating");
    setError("");
    try {
      const granted = await ensureOllamaPermission();
      if (!granted) throw new Error("Permission to reach localhost was denied.");
      const result = await generateDebrief(input, settings.aiChatModel);
      await save(id, result, settings.aiChatModel, "debrief");
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      generatingRef.current = false;
    }
  }

  useEffect(() => {
    if (
      open &&
      !report &&
      input &&
      settings.ollamaEnabled &&
      settings.aiDebrief &&
      status !== "error"
    ) {
      void generate();
    }
    // `generate` is recreated per render; the guard above keeps it single-fire.
  }, [open, report, input, settings.ollamaEnabled, settings.aiDebrief, status]);

  if (!settings.ollamaEnabled || !settings.aiDebrief) return null;

  const busy = status === "generating";

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="label-mono">Today's Debrief</h3>
        {input && (
          <button
            onClick={generate}
            disabled={busy}
            className="text-xs text-muted bg-white/[0.04] hover:text-ink hover:bg-white/[0.07] disabled:opacity-50 px-2.5 py-1 rounded-[9px] transition-colors border border-border"
          >
            {busy ? "Thinking…" : "Regenerate"}
          </button>
        )}
      </div>
      <div className="bg-surface rounded-xl p-4 border border-hairline space-y-3">
        {report ? (
          <>
            <p className="text-sm text-muted leading-relaxed">{report.summary}</p>
            {report.sections.map((s) => (
              <div key={s.heading}>
                <div className="text-xs font-medium text-ink mb-1">{s.heading}</div>
                <p className="text-sm text-muted leading-relaxed">{s.text}</p>
              </div>
            ))}
            {busy && <p className="text-xs text-faint">Refreshing…</p>}
          </>
        ) : busy ? (
          <p className="text-sm text-faint">Thinking…</p>
        ) : status === "error" ? (
          <p className="text-xs text-status-unvisited">
            Couldn't generate the debrief ({error}). Is Ollama running?
          </p>
        ) : (
          <p className="text-sm text-faint">Nothing to debrief yet today.</p>
        )}
      </div>
    </section>
  );
}