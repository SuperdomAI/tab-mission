import Fuse from "fuse.js";
import type { EnrichedTab, SavedSession } from "../types/index";
import type { SessionSummaryEntry } from "./ai/sessionMemory";
import { mergeSemanticFuse, type ScoredMatch } from "./ai/embed";

/** Single Fuse config for tab search — used only here (no duplicate configs). */
export function buildTabFuse(tabs: EnrichedTab[]): Fuse<EnrichedTab> {
  return new Fuse(tabs, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "url", weight: 0.2 },
      { name: "domain", weight: 0.2 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });
}

export function searchTabs(
  fuse: Fuse<EnrichedTab>,
  query: string,
  limit = 8,
): EnrichedTab[] {
  if (!query.trim()) return [];
  return fuse.search(query).slice(0, limit).map((r) => r.item);
}

/** A tab row as the F7 palette renders it: `semantic` flags the accent dot. */
export interface TabSearchResult {
  tab: EnrichedTab;
  /** True when this row's match came from embeddings, not Fuse. */
  semantic: boolean;
}

/**
 * F7 semantic ⌘K search — the semantic-first merge. Embedding hits (already
 * gated on `COSINE_THRESHOLD` by `topKSimilar`) rank first, Fuse fills the
 * rest; ids present in both lists appear once, flagged semantic. An empty
 * semantic list (AI off, or nothing cleared the threshold) is exactly
 * today's pure-Fuse behavior.
 */
export function searchTabsSemantic(
  tabs: EnrichedTab[],
  fuse: Fuse<EnrichedTab>,
  query: string,
  semantic: ScoredMatch[],
  limit = 8,
): TabSearchResult[] {
  if (!query.trim()) return [];
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const semanticIds = new Set(semantic.map((m) => m.id));
  const fuseIds = searchTabs(fuse, query, limit).map((t) => t.id);
  const merged = mergeSemanticFuse(semantic, fuseIds, limit);
  const results: TabSearchResult[] = [];
  for (const id of merged) {
    const tab = byId.get(id);
    if (tab) results.push({ tab, semantic: semanticIds.has(id) });
  }
  return results;
}

/** A session as the F4 palette search sees it (name + AI summary). */
export interface SessionDoc {
  id: string;
  name: string;
  summary: string;
}

/**
 * F4 "Search sessions" — Fuse over session names + AI summaries (Fuse.js
 * title fallback when AI is off: summaries simply don't exist yet). Merges
 * the authoritative `aiSessionSummaries` map over the `SavedSession.summary`
 * backfill.
 */
export function buildSessionFuse(
  sessions: SavedSession[],
  summaries: Record<string, SessionSummaryEntry>,
): Fuse<SessionDoc> {
  const docs: SessionDoc[] = sessions.map((s) => ({
    id: s.id,
    name: s.name,
    summary: summaries[s.id]?.summary ?? s.summary ?? "",
  }));
  return new Fuse(docs, {
    keys: [
      { name: "name", weight: 0.6 },
      { name: "summary", weight: 0.4 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
  });
}

export function searchSessions(
  fuse: Fuse<SessionDoc>,
  query: string,
  limit = 5,
): SessionDoc[] {
  if (!query.trim()) return [];
  return fuse.search(query).slice(0, limit).map((r) => r.item);
}

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

export function filterCommands(
  commands: PaletteCommand[],
  query: string,
): PaletteCommand[] {
  if (!query.trim()) return commands;
  const q = query.toLowerCase();
  return commands.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.keywords?.some((k) => k.toLowerCase().includes(q)),
  );
}
