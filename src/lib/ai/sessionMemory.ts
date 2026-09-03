/**
 * F4 session memory — backed by the `aiSessionSummaries` key in
 * `chrome.storage.local`, written by BOTH the React layer (UI saves via
 * `persistSession`) and the service worker (auto-save on window close) —
 * the `aiTriagePlan` dual-owner precedent.
 *
 * Storage shape is a map: `{ [sessionId]: { summary, generatedAt, model } }`.
 * `SavedSession.summary?` is backfilled as an in-session cache; the
 * authoritative map stays separate so nothing depends on touching the SW's
 * session writes. Freshness is the `sessionSummary` task TTL (30 days) +
 * model-mismatch rejection, mirroring `AiCache`.
 */

import { TASK_TTL_MS, DAY } from "./cache";
import { buildSessionSummaryPrompt, type SessionLite } from "./prompts";
import { extractJson, coerceString } from "./parse";
import { generate } from "../ollama";
import { mergeSettings, type AppSettings, type SavedSession } from "../../types/index";

export const AI_SESSION_SUMMARIES_KEY = "aiSessionSummaries";

/** The `sessionSummary` task TTL (30 days) — a session's summary ages slowly. */
export const SESSION_SUMMARY_TTL_MS = TASK_TTL_MS.sessionSummary;

export interface SessionSummaryEntry {
  summary: string;
  generatedAt: number;
  model: string;
}

/** Summary storage map: sessionId → entry (same shape as `AIReportsMap`). */
export type SessionSummariesMap = Record<string, SessionSummaryEntry>;

// ─── parser (single funnel: extractJson → shape validation) ─────────────────

/** Parse the model's `{ "summary": "…" }` response; null on garbage. */
export function parseSessionSummary(text: string): string | null {
  const root = extractJson(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  return coerceString((root as Record<string, unknown>).summary);
}

// ─── storage coercion + freshness (map, like AIReports) ──────────────────────

/** Coerce whatever is on disk into a valid summaries map, dropping bad rows. */
export function coerceSessionSummaries(raw: unknown): SessionSummariesMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SessionSummariesMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const e = value as Record<string, unknown>;
    const summary = coerceString(e.summary);
    if (summary && typeof e.generatedAt === "number" && typeof e.model === "string") {
      out[id] = { summary, generatedAt: e.generatedAt, model: e.model };
    }
  }
  return out;
}

/** The summaries cache: reads are view-only, `set` returns a new instance. */
export class SessionSummaryCache {
  private constructor(private entries: SessionSummariesMap = {}) {}

  static empty(): SessionSummaryCache {
    return new SessionSummaryCache();
  }

  static fromStorage(raw: unknown): SessionSummaryCache {
    return new SessionSummaryCache(coerceSessionSummaries(raw));
  }

  /**
   * Fresh entry for a session id, or undefined when missing, past the 30-day
   * TTL, or produced by a different model.
   */
  get(
    id: string,
    model: string,
    now: number = Date.now(),
  ): SessionSummaryEntry | undefined {
    const entry = this.entries[id];
    if (!entry) return undefined;
    if (entry.model !== model || now - entry.generatedAt > SESSION_SUMMARY_TTL_MS) {
      return undefined;
    }
    return entry;
  }

  /** Raw entry for a session id (display/search; freshness not enforced). */
  entry(id: string): SessionSummaryEntry | undefined {
    return this.entries[id];
  }

  /** Raw map (CommandPalette session search merges over it). */
  map(): SessionSummariesMap {
    return this.entries;
  }

  /**
   * A new cache with this summary stored (replacing any prior entry) and
   * entries older than 30 days pruned — summaries are tiny, but the map grows
   * one row per saved session forever otherwise.
   */
  set(
    id: string,
    summary: string,
    model: string,
    now: number = Date.now(),
  ): SessionSummaryCache {
    const cutoff = now - 30 * DAY;
    const entries: SessionSummariesMap = {};
    for (const [key, entry] of Object.entries(this.entries)) {
      if (entry.generatedAt >= cutoff) entries[key] = entry;
    }
    entries[id] = { summary, generatedAt: now, model };
    return new SessionSummaryCache(entries);
  }

  toJSON(): SessionSummariesMap {
    return this.entries;
  }
}

// ─── generation ──────────────────────────────────────────────────────────────

/** Generate a session summary; throws when the model output is unparseable. */
export async function generateSessionSummary(
  session: SessionLite,
  model: string,
): Promise<string> {
  const text = await generate(buildSessionSummaryPrompt(session), model, "chat");
  const summary = parseSessionSummary(text);
  if (!summary) throw new Error("Session summary output did not match the expected shape");
  return summary;
}

/**
 * Fire-and-forget session summarization, shared by the UI (`persistSession`)
 * and the service worker (window auto-save). Gates on the AI master + the
 * `aiSessionMemory` toggle, generates with the chat tier, writes
 * `aiSessionSummaries[sessionId]` (read-modify-write so parallel summaries
 * don't clobber each other) and optionally backfills `SavedSession.summary`
 * (a best-effort in-session cache — a lost backfill is fine, the map is
 * authoritative). Never throws.
 */
export async function summarizeSession(
  session: SavedSession,
  backfill: boolean = true,
): Promise<void> {
  try {
    const settingsRes = await chrome.storage.sync.get("settings");
    const settings = mergeSettings(settingsRes.settings as AppSettings | undefined);
    if (!settings.ollamaEnabled || !settings.aiSessionMemory) return;
    const model = settings.aiChatModel;
    const summary = await generateSessionSummary(
      { name: session.name, tabs: session.tabs.map((t) => ({ title: t.title, url: t.url })) },
      model,
    );
    const stored = await chrome.storage.local.get(AI_SESSION_SUMMARIES_KEY);
    const merged = SessionSummaryCache.fromStorage(stored[AI_SESSION_SUMMARIES_KEY]).set(
      session.id,
      summary,
      model,
    );
    await chrome.storage.local.set({ [AI_SESSION_SUMMARIES_KEY]: merged.toJSON() });
    if (backfill) await backfillSessionSummary(session.id, summary);
  } catch (e) {
    console.error("[TMC] session summary error:", e);
  }
}

/** Best-effort `SavedSession.summary` backfill; no-op when the session is gone. */
async function backfillSessionSummary(sessionId: string, summary: string): Promise<void> {
  const result = (await chrome.storage.local.get("sessions")) as {
    sessions?: SavedSession[];
  };
  const sessions: SavedSession[] = result.sessions ?? [];
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  const next = [...sessions];
  next[idx] = { ...next[idx], summary };
  await chrome.storage.local.set({ sessions: next });
}