import { useEffect, useMemo, useRef, useState } from "react";
import { useTabStore } from "../../store/tabStore";
import { useAnalyticsStore } from "../../store/analyticsStore";
import { useAIReports } from "../hooks/useAIReports";
import {
  coachDaysFromAnalytics,
  coachReportId,
  generateCoach,
  hasCoachData,
  isoWeekKey,
  type CoachReport,
  type InsightSeverity,
} from "../../lib/ai/reports";
import { ensureOllamaPermission } from "../../lib/ollama";

/**
 * Severity is a status, so it earns one of the system status colors (color =
 * information rule); "notice" stays neutral.
 */
const SEVERITY_DOT: Record<InsightSeverity, string> = {
  notice: "bg-white/20",
  pattern: "bg-status-stale",
  concern: "bg-status-unvisited",
};

/**
 * F11 — "Coach": 2-3 honest patterns + one actionable suggestion from the
 * local chat model over the last 30 days of analytics. Cached per ISO week in
 * `aiReports`, regenerated when the Weekly Report opens and the week's report
 * is missing or stale (TTL 6 h). Never interrupts — drawer-only, by design.
 */
export default function CoachCard({ open }: { open: boolean }) {
  const settings = useTabStore((s) => s.settings);
  const analytics = useAnalyticsStore((s) => s.analytics);
  const { getEntry, save } = useAIReports();
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState("");
  const generatingRef = useRef(false);

  const days = useMemo(() => coachDaysFromAnalytics(analytics), [analytics]);
  const hasData = hasCoachData(days);

  const id = coachReportId(isoWeekKey(new Date()));
  const entry = getEntry<CoachReport>(id, settings.aiChatModel, "coach");
  const report = entry?.result;

  async function generate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setStatus("generating");
    setError("");
    try {
      const granted = await ensureOllamaPermission();
      if (!granted) throw new Error("Permission to reach localhost was denied.");
      const result = await generateCoach(days, settings.aiChatModel);
      await save(id, result, settings.aiChatModel, "coach");
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
      hasData &&
      settings.ollamaEnabled &&
      settings.aiCoach &&
      status !== "error"
    ) {
      void generate();
    }
  }, [open, report, hasData, settings.ollamaEnabled, settings.aiCoach, status]);

  // A previous failure must not block auto-generation for a new week or a
  // fresh drawer open (Ollama may have come back) — reset on both.
  useEffect(() => {
    setStatus("idle");
    setError("");
  }, [id, open]);

  if (!settings.ollamaEnabled || !settings.aiCoach) return null;

  const busy = status === "generating";

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="label-mono">Coach · 30 Days</h3>
        {hasData && (
          <button
            onClick={generate}
            disabled={busy}
            className="text-xs text-muted bg-white/[0.04] hover:text-ink hover:bg-white/[0.07] disabled:opacity-50 px-2.5 py-1 rounded-[9px] transition-colors border border-border"
          >
            {busy ? "Thinking…" : "Regenerate"}
          </button>
        )}
      </div>
      <div className="bg-surface rounded-xl p-4 border border-hairline">
        {report ? (
          <div className="space-y-3">
            {report.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[insight.severity]}`}
                  title={insight.severity}
                />
                <p className="text-sm text-muted leading-relaxed flex-1">
                  {insight.text}
                </p>
              </div>
            ))}
            {busy && <p className="text-xs text-faint">Refreshing…</p>}
          </div>
        ) : busy ? (
          <p className="text-sm text-faint">Thinking…</p>
        ) : status === "error" ? (
          <p className="text-xs text-status-unvisited">
            Couldn't generate the coach report ({error}). Is Ollama running?
          </p>
        ) : (
          <p className="text-sm text-faint">
            Not enough activity in the last 30 days yet.
          </p>
        )}
      </div>
    </section>
  );
}
