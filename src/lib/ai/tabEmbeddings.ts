/**
 * F7 semantic ⌘K search — backed by the `aiTabEmbeddings` key in
 * `chrome.storage.local`, written ONLY by the React layer (the ⌘K palette —
 * UI-owned, the same precedent as `aiSuggestions`; the service worker never
 * touches it).
 *
 * Storage shape is a single embeddings object for one embed model:
 *
 *   { model, dims, vectors: { [tabId]: { title, vector, embeddedAt } } }
 *
 * A vector is keyed by the triple `{ model, tabId, title }` (the per-entry
 * `title`/`embeddedAt` fields are additive beyond the plan doc's `{ model,
 * dims, vectors: { [tabId]: number[] } }` sketch): changing the embed model
 * invalidates the whole envelope (a different vector space — the first write
 * under the new model starts a fresh map), changing a tab's title invalidates
 * just that tab's entry, and `embeddedAt` enforces the `embed` task TTL
 * (24 h). `ensureTabEmbeddings` re-embeds only the stale entries in one batch
 * call and prunes vectors for closed tabs. Search reads fresh entries only
 * (`vectorsFor`), gates on `COSINE_THRESHOLD` (0.32), and the palette merges
 * semantic-first with the existing Fuse tab search via `mergeSemanticFuse`.
 */

import { TASK_TTL_MS } from "./cache";
import { COSINE_THRESHOLD, topKSimilar, type ScoredMatch } from "./embed";
import { embed } from "../ollama";

export type { ScoredMatch } from "./embed";

export const AI_TAB_EMBEDDINGS_KEY = "aiTabEmbeddings";

/** The `embed` task TTL (24 h) — a tab's vector ages out in a day. */
export const EMBED_TTL_MS = TASK_TTL_MS.embed;

/** The palette's query debounce before embedding the search text (ms). */
export const QUERY_DEBOUNCE_MS = 250;

export interface EmbeddableTab {
  id: number;
  title: string;
  domain: string;
}

export interface TabVectorEntry {
  /** The tab text this vector was embedded from (title-keyed invalidation). */
  title: string;
  vector: number[];
  embeddedAt: number;
}

export interface TabEmbeddings {
  /** The embed model that produced every vector (whole-envelope invalidation). */
  model: string;
  /** Vector dimensionality — an entry of any other length is malformed. */
  dims: number;
  /** tabId → per-tab entry. */
  vectors: Record<number, TabVectorEntry>;
}

/** The text embedded for a tab: title + domain (empty title → domain alone). */
export function tabEmbedText(tab: EmbeddableTab): string {
  const title = tab.title.trim();
  return title ? `${title} ${tab.domain}` : tab.domain;
}

/**
 * Coerce whatever is on disk into a valid embeddings object, or null.
 * Malformed envelopes are rejected and malformed entries dropped (never
 * trust disk — the same rule as every other AI cache); an entry whose
 * vector length disagrees with the envelope's `dims` is garbage.
 */
export function coerceTabEmbeddings(raw: unknown): TabEmbeddings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.model !== "string" || typeof r.dims !== "number" || r.dims <= 0) {
    return null;
  }
  if (!r.vectors || typeof r.vectors !== "object" || Array.isArray(r.vectors)) {
    return null;
  }
  const vectors: Record<number, TabVectorEntry> = {};
  for (const [key, value] of Object.entries(r.vectors as Record<string, unknown>)) {
    const tabId = Number(key);
    if (!Number.isInteger(tabId) || tabId <= 0) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const e = value as Record<string, unknown>;
    if (typeof e.title !== "string" || typeof e.embeddedAt !== "number") continue;
    if (!Array.isArray(e.vector) || e.vector.length !== r.dims) continue;
    if (!e.vector.every((n) => typeof n === "number")) continue;
    vectors[tabId] = { title: e.title, vector: e.vector, embeddedAt: e.embeddedAt };
  }
  if (Object.keys(vectors).length === 0) return null;
  return { model: r.model, dims: r.dims, vectors };
}

/** Immutable freshness wrapper over the stored embeddings object. */
export class TabEmbeddingCache {
  private constructor(private embeddings: TabEmbeddings | null) {}

  static empty(): TabEmbeddingCache {
    return new TabEmbeddingCache(null);
  }

  static fromStorage(raw: unknown): TabEmbeddingCache {
    return new TabEmbeddingCache(coerceTabEmbeddings(raw));
  }

  /**
   * Fresh vector for a tab, or undefined when missing, expired, produced by a
   * different model, or the tab text changed since it was embedded.
   */
  get(
    model: string,
    tabId: number,
    text: string,
    now: number = Date.now(),
  ): number[] | undefined {
    const entry = this.embeddings?.vectors[tabId];
    if (!entry) return undefined;
    if (
      this.embeddings!.model !== model ||
      entry.title !== text ||
      now - entry.embeddedAt > EMBED_TTL_MS
    ) {
      return undefined;
    }
    return entry.vector;
  }

  /**
   * Fresh searchable vectors for the current model, keyed by tab id. Stale
   * entries (expired) and foreign-model envelopes (a different vector space)
   * are excluded — cosine over mismatched spaces is meaningless.
   */
  vectorsFor(model: string, now: number = Date.now()): Map<number, number[]> {
    const out = new Map<number, number[]>();
    const e = this.embeddings;
    if (!e || e.model !== model) return out;
    for (const [id, entry] of Object.entries(e.vectors)) {
      if (now - entry.embeddedAt <= EMBED_TTL_MS) out.set(Number(id), entry.vector);
    }
    return out;
  }

  /**
   * A new cache with this tab's vector stored. The first set fixes the
   * envelope's model + dims; setting under a different model starts a fresh
   * vector map (the old model's space is gone). Zero-length vectors are
   * rejected (dims must be positive).
   */
  set(
    model: string,
    tabId: number,
    text: string,
    vector: number[],
    now: number = Date.now(),
  ): TabEmbeddingCache {
    if (vector.length === 0) return this;
    const current = this.embeddings;
    const sameModel = current !== null && current.model === model;
    const vectors = sameModel ? { ...current!.vectors } : {};
    vectors[tabId] = { title: text, vector, embeddedAt: now };
    return new TabEmbeddingCache({
      model,
      dims: sameModel ? current!.dims : vector.length,
      vectors,
    });
  }

  /** Drop entries for tabs that no longer exist; `this` when nothing drops. */
  prune(validIds: Set<number>): TabEmbeddingCache {
    const e = this.embeddings;
    if (!e) return this;
    const entries = Object.entries(e.vectors);
    if (entries.every(([id]) => validIds.has(Number(id)))) return this;
    const vectors: Record<number, TabVectorEntry> = {};
    for (const [key, entry] of entries) {
      const tabId = Number(key);
      if (validIds.has(tabId)) vectors[tabId] = entry;
    }
    return new TabEmbeddingCache({ model: e.model, dims: e.dims, vectors });
  }

  toJSON(): TabEmbeddings | null {
    return this.embeddings;
  }
}

/**
 * Re-embed the tabs whose stored vector is stale (missing, expired, wrong
 * model, or the title changed) in ONE batch call and prune vectors for
 * closed tabs. Returns the same cache instance when nothing changed (the
 * palette saves only when the instance differs — no write loop). Throws on
 * transport failure; callers catch and fall back to pure Fuse.
 */
export async function ensureTabEmbeddings(
  tabs: EmbeddableTab[],
  model: string,
  cache: TabEmbeddingCache,
  now: number = Date.now(),
): Promise<TabEmbeddingCache> {
  const validIds = new Set(tabs.map((t) => t.id));
  const stale = tabs.filter((t) => !cache.get(model, t.id, tabEmbedText(t), now));
  let next = cache;
  if (stale.length > 0) {
    const texts = stale.map((t) => tabEmbedText(t));
    const vectors = await embed(texts, model);
    if (vectors.length !== stale.length) {
      throw new Error("Embedding count mismatch");
    }
    for (let i = 0; i < stale.length; i++) {
      next = next.set(model, stale[i].id, texts[i], vectors[i], now);
    }
  }
  return next.prune(validIds);
}

/**
 * The semantic side of the ⌘K merge: top-k fresh vectors vs the query vector,
 * gated on `COSINE_THRESHOLD`. The palette feeds the result into
 * `mergeSemanticFuse` alongside the Fuse hits.
 */
export function searchSemanticTabs(
  queryVector: number[],
  cache: TabEmbeddingCache,
  model: string,
  k: number = 8,
  threshold: number = COSINE_THRESHOLD,
  now: number = Date.now(),
): ScoredMatch[] {
  return topKSimilar(queryVector, cache.vectorsFor(model, now), k, threshold);
}