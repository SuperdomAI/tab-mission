/**
 * F6 summarize-then-close — backed by the `aiReadingList` key in
 * `chrome.storage.local`, written ONLY by the React layer (UI-owned, the
 * same precedent as `aiSuggestions` / `aiTabEmbeddings`; the service worker
 * never touches it).
 *
 * Storage shape is a capped list of page summaries:
 *
 *   [{ id, url, title, summary, savedAt }]   (newest last, cap 100)
 *
 * `id` is content-addressed — `sha1("summarizePage\n" + pageSignature)`,
 * the same formula as `AiCache.key` — so closing the SAME page again within
 * the `summarizePage` task TTL (7 days) reuses the stored summary without a
 * second model call, and a re-summarized page never duplicates a row. The
 * UI persists an entry BEFORE closing the tab (order guaranteed), and its
 * undo path reopens the tab + removes the entry.
 */

import { TASK_TTL_MS } from "./cache";
import { extractJson, coerceString } from "./parse";
import { pageSignature, sha1Hex } from "./signatures";
import { buildSummarizePagePrompt, type PageLite } from "./prompts";
import { generate } from "../ollama";

export const AI_READING_LIST_KEY = "aiReadingList";

/** Cap on stored entries (storage-quota budget: ~100 small summaries). */
export const READING_LIST_CAP = 100;

/** The `summarizePage` task TTL (7 days) — a page's summary ages slowly. */
export const SUMMARIZE_PAGE_TTL_MS = TASK_TTL_MS.summarizePage;

export interface ReadingEntry {
  /** Content-addressed: sha1("summarizePage\n" + pageSignature(title, text)). */
  id: string;
  url: string;
  title: string;
  summary: string;
  savedAt: number;
}

export interface PageSummary {
  summary: string;
  whyItMatters: string;
}

/** Content key for a page's summary (mirrors `AiCache.key`). */
export function entryId(title: string, text: string): string {
  return sha1Hex(`summarizePage\n${pageSignature(title, text)}`);
}

// ─── parser (single funnel: extractJson → shape validation) ─────────────────

/** Parse the model's `{ summary, whyItMatters }` response; null on garbage. */
export function parseSummarizePage(text: string): PageSummary | null {
  const root = extractJson(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const r = root as Record<string, unknown>;
  const summary = coerceString(r.summary);
  const whyItMatters = coerceString(r.whyItMatters);
  if (!summary) return null;
  return { summary, whyItMatters: whyItMatters ?? "" };
}

/** The stored summary text: bullets + the closing why-it-mattered line. */
export function composeSummary(summary: string, whyItMatters: string): string {
  return whyItMatters ? `${summary}\n${whyItMatters}` : summary;
}

// ─── storage coercion + freshness (capped list, newest last) ─────────────────

/** Coerce whatever is on disk into a valid entry list (never trust disk). */
export function coerceReadingList(raw: unknown): ReadingEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReadingEntry[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const e = value as Record<string, unknown>;
    const summary = coerceString(e.summary);
    if (
      typeof e.id === "string" &&
      typeof e.url === "string" &&
      typeof e.title === "string" &&
      summary &&
      typeof e.savedAt === "number"
    ) {
      out.push({ id: e.id, url: e.url, title: e.title, summary, savedAt: e.savedAt });
    }
  }
  return out.slice(-READING_LIST_CAP);
}

/** Immutable freshness wrapper over the stored list (newest last). */
export class ReadingList {
  private constructor(private entries: ReadingEntry[]) {}

  static empty(): ReadingList {
    return new ReadingList([]);
  }

  static fromStorage(raw: unknown): ReadingList {
    return new ReadingList(coerceReadingList(raw));
  }

  /** Raw entry for an id, or undefined. */
  find(id: string): ReadingEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Entry still within the 7-day summarize TTL (the reuse window). */
  findFresh(id: string, now: number = Date.now()): ReadingEntry | undefined {
    const e = this.find(id);
    if (!e) return undefined;
    return now - e.savedAt <= SUMMARIZE_PAGE_TTL_MS ? e : undefined;
  }

  /** Raw list, oldest → newest (the drawer renders it reversed). */
  toArray(): ReadingEntry[] {
    return this.entries;
  }

  /**
   * A new list with this entry stored: an existing entry with the same
   * content id is replaced in place (a re-summarized page never duplicates),
   * then the list is capped at `READING_LIST_CAP` (oldest dropped).
   */
  add(entry: ReadingEntry): ReadingList {
    const without = this.entries.filter((e) => e.id !== entry.id);
    return new ReadingList([...without, entry].slice(-READING_LIST_CAP));
  }

  /** A new list without this entry. */
  remove(id: string): ReadingList {
    return new ReadingList(this.entries.filter((e) => e.id !== id));
  }

  toJSON(): ReadingEntry[] {
    return this.entries;
  }
}

// ─── generation (thin wrapper over the chat-tier transport) ─────────────────

/** Generate a page summary; throws when the model output is unparseable. */
export async function generatePageSummary(
  page: PageLite,
  model: string,
): Promise<PageSummary> {
  const text = await generate(buildSummarizePagePrompt(page), model, "chat");
  const parsed = parseSummarizePage(text);
  if (!parsed) throw new Error("Page summary output did not match the expected shape");
  return parsed;
}