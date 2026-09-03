/**
 * F1 daily debrief + F11 habits coach — the two report features backed by the
 * `aiReports` key in `chrome.storage.local`.
 *
 * Everything here is pure (parsers, input builders, cache logic) or a thin
 * wrapper over the Ollama transport; the React layer (`useAIReports`) only
 * orchestrates. Cache semantics mirror `AiCache`: an entry is rejected (not
 * deleted — regeneration replaces it) when the task's TTL expires or the
 * model changed.
 */

import { TASK_TTL_MS, DAY, type CacheEntry } from "./cache";
import {
  buildDebriefPrompt,
  buildCoachPrompt,
  type DebriefInput,
  type CoachDay,
} from "./prompts";
import { extractJson, coerceString } from "./parse";
import { generate } from "../ollama";
import type { DailyAnalytics } from "../../types/index";

export const AI_REPORTS_KEY = "aiReports";

/** Tasks that write into `aiReports` (TTLs live in `TASK_TTL_MS`). */
export type ReportTask = "debrief" | "coach";

/**
 * Report storage map: `"debrief:2026-09-03"` / `"coach:2026-W36"` →
 * cache entry. Human-readable keys keep the storage debuggable; entries are
 * `CacheEntry` (`{ result, generatedAt, model }`).
 */
export type AIReportsMap = Record<string, CacheEntry<unknown>>;

// ─── report shapes ───────────────────────────────────────────────────────────

export interface DebriefSection {
  heading: string;
  text: string;
}

export interface DebriefReport {
  summary: string;
  sections: DebriefSection[];
}

export type InsightSeverity = "notice" | "pattern" | "concern";

export interface CoachInsight {
  text: string;
  severity: InsightSeverity;
}

export interface CoachReport {
  insights: CoachInsight[];
}

// ─── parsers (single funnel: extractJson → shape validation) ────────────────

export function parseDebriefReport(text: string): DebriefReport | null {
  const root = extractJson(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const summary = coerceString((root as Record<string, unknown>).summary);
  if (!summary) return null;
  const sections: DebriefSection[] = [];
  const rawSections = (root as Record<string, unknown>).sections;
  if (Array.isArray(rawSections)) {
    for (const raw of rawSections) {
      if (!raw || typeof raw !== "object") continue;
      const heading = coerceString((raw as Record<string, unknown>).heading);
      const text = coerceString((raw as Record<string, unknown>).text);
      if (heading && text) sections.push({ heading, text });
    }
  }
  return { summary, sections };
}

const SEVERITIES: InsightSeverity[] = ["notice", "pattern", "concern"];

export function parseCoachReport(text: string): CoachReport | null {
  const root = extractJson(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const rawInsights = (root as Record<string, unknown>).insights;
  if (!Array.isArray(rawInsights)) return null;
  const insights: CoachInsight[] = [];
  for (const raw of rawInsights) {
    if (!raw || typeof raw !== "object") continue;
    const insightText = coerceString((raw as Record<string, unknown>).text);
    const severity = coerceString((raw as Record<string, unknown>).severity);
    if (
      !insightText ||
      !severity ||
      !SEVERITIES.includes(severity as InsightSeverity)
    ) {
      continue;
    }
    insights.push({ text: insightText, severity: severity as InsightSeverity });
  }
  return insights.length > 0 ? { insights } : null;
}

// ─── report ids ───────────────────────────────────────────────────────────────

/**
 * ISO 8601 week key ("2026-W36") computed in UTC to match the analytics dates
 * (which are `toISOString().slice(0, 10)` — UTC).
 */
export function isoWeekKey(d: Date): string {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const debriefReportId = (date: string): string => `debrief:${date}`;

export const coachReportId = (week: string): string => `coach:${week}`;

// ─── cache (mirrors AiCache freshness, keyed by report id) ───────────────────

/** The report cache: reads are view-only, `set` returns a new instance. */
export class AIReportCache {
  private constructor(private entries: AIReportsMap = {}) {}

  static empty(): AIReportCache {
    return new AIReportCache();
  }

  /** Coerce whatever is on disk into a usable cache, dropping malformed rows. */
  static fromStorage(raw: unknown): AIReportCache {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return new AIReportCache();
    }
    const entries: AIReportsMap = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const e = value as Record<string, unknown>;
      if (
        typeof e.generatedAt === "number" &&
        typeof e.model === "string" &&
        "result" in e
      ) {
        entries[id] = {
          result: e.result,
          generatedAt: e.generatedAt,
          model: e.model,
        } as CacheEntry<unknown>;
      }
    }
    return new AIReportCache(entries);
  }

  /**
   * Fresh entry for this report id, or `undefined` when missing, expired for
   * the task, or produced by a different model. Stale entries are kept (not
   * dropped) so the UI can show "regenerating" without a storage write.
   */
  get<T>(
    id: string,
    model: string,
    task: ReportTask,
    now: number = Date.now(),
  ): CacheEntry<T> | undefined {
    const entry = this.entries[id] as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.model !== model || now - entry.generatedAt > TASK_TTL_MS[task]) {
      return undefined;
    }
    return entry;
  }

  /**
   * A new cache with this report stored (replacing any prior entry) and
   * entries older than 30 days pruned — reports are tiny, but the map grows
   * one row per day/week forever otherwise.
   */
  set<T>(
    id: string,
    result: T,
    model: string,
    task: ReportTask,
    now: number = Date.now(),
  ): AIReportCache {
    const cutoff = now - 30 * DAY;
    const entries: AIReportsMap = {};
    for (const [key, entry] of Object.entries(this.entries)) {
      if (entry.generatedAt >= cutoff) entries[key] = entry;
    }
    entries[id] = { result, generatedAt: now, model } as CacheEntry<unknown>;
    return new AIReportCache(entries);
  }

  toJSON(): AIReportsMap {
    return this.entries;
  }
}

// ─── input builders ──────────────────────────────────────────────────────────

/**
 * The debrief input for today, or `null` when there is nothing worth
 * debriefing (no domains visited and no tab activity recorded).
 */
export function debriefInputFromDay(
  day: DailyAnalytics | null,
  domains: string[],
): DebriefInput | null {
  if (!day) return null;
  const hasData =
    domains.length > 0 ||
    day.totalTabsOpened > 0 ||
    day.totalTabsClosed > 0 ||
    day.peakTabCount > 0;
  if (!hasData) return null;
  return {
    date: day.date,
    domains,
    opened: day.totalTabsOpened,
    closed: day.totalTabsClosed,
    peak: day.peakTabCount,
    debt: day.tabDebtScore,
  };
}

function topDomainsN(
  domainTime: Record<string, number>,
  n: number,
): string[] {
  return Object.entries(domainTime)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([domain]) => domain);
}

/**
 * The last 30 days of analytics as coach input, most recent last (the prompt
 * contract). Days with no recorded data are included as zeros so the window
 * shape is stable. `now` is injectable for tests.
 */
export function coachDaysFromAnalytics(
  analytics: DailyAnalytics[],
  now: Date = new Date(),
): CoachDay[] {
  const days: CoachDay[] = [];
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 29; i >= 0; i--) {
    const d = new Date(utcToday - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const day = analytics.find((a) => a.date === key);
    days.push({
      date: key,
      domains: day ? topDomainsN(day.domainTime, 3) : [],
      opened: day?.totalTabsOpened ?? 0,
      closed: day?.totalTabsClosed ?? 0,
      debt: day?.tabDebtScore ?? 0,
    });
  }
  return days;
}

/** True when a 30-day window has anything worth coaching on. */
export function hasCoachData(days: CoachDay[]): boolean {
  return days.some(
    (d) =>
      d.domains.length > 0 || d.opened > 0 || d.closed > 0 || d.debt > 0,
  );
}

// ─── generation (thin wrappers over the transport) ───────────────────────────

/** Generate today's debrief; throws when the model output is unparseable. */
export async function generateDebrief(
  input: DebriefInput,
  model: string,
): Promise<DebriefReport> {
  const text = await generate(buildDebriefPrompt(input), model, "chat");
  const report = parseDebriefReport(text);
  if (!report) throw new Error("Debrief output did not match the expected shape");
  return report;
}

/** Generate the 30-day coach report; throws when the output is unparseable. */
export async function generateCoach(
  days: CoachDay[],
  model: string,
): Promise<CoachReport> {
  const text = await generate(buildCoachPrompt(days), model, "chat");
  const report = parseCoachReport(text);
  if (!report) throw new Error("Coach output did not match the expected shape");
  return report;
}