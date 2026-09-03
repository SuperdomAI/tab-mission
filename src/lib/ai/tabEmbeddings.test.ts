import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AI_TAB_EMBEDDINGS_KEY,
  EMBED_TTL_MS,
  QUERY_DEBOUNCE_MS,
  TabEmbeddingCache,
  coerceTabEmbeddings,
  ensureTabEmbeddings,
  searchSemanticTabs,
  tabEmbedText,
  type TabEmbeddings,
} from "./tabEmbeddings";
import { TASK_TTL_MS, DAY } from "./cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = 2_000_000_000_000;
const MODEL = "nomic-embed-text";

const entry = (over: Partial<TabEmbeddings["vectors"][number]> = {}) => ({
  title: "Launch notes example.com",
  vector: [1, 0],
  embeddedAt: NOW,
  ...over,
});

const embeddings = (over: Partial<TabEmbeddings> = {}): TabEmbeddings => ({
  model: MODEL,
  dims: 2,
  vectors: { 1: entry(), 2: entry({ title: "Roadmap roadmap.com", vector: [0.5, 0.5] }) },
  ...over,
});

// ─── tabEmbedText ────────────────────────────────────────────────────────────

describe("tabEmbedText", () => {
  it("joins title and domain", () => {
    expect(tabEmbedText({ id: 1, title: "Launch notes", domain: "docs.dev" })).toBe(
      "Launch notes docs.dev",
    );
  });

  it("falls back to the domain when the title is empty or whitespace", () => {
    expect(tabEmbedText({ id: 1, title: "", domain: "docs.dev" })).toBe("docs.dev");
    expect(tabEmbedText({ id: 1, title: "   ", domain: "docs.dev" })).toBe("docs.dev");
  });
});

// ─── coerceTabEmbeddings ─────────────────────────────────────────────────────

describe("coerceTabEmbeddings", () => {
  it("accepts a valid stored object", () => {
    expect(coerceTabEmbeddings(embeddings())).toEqual(embeddings());
  });

  it("rejects malformed envelopes", () => {
    expect(coerceTabEmbeddings(null)).toBeNull();
    expect(coerceTabEmbeddings("x")).toBeNull();
    expect(coerceTabEmbeddings([embeddings()])).toBeNull();
    expect(coerceTabEmbeddings({ ...embeddings(), model: 42 })).toBeNull();
    expect(coerceTabEmbeddings({ ...embeddings(), dims: 0 })).toBeNull();
    expect(coerceTabEmbeddings({ ...embeddings(), dims: "two" })).toBeNull();
    expect(coerceTabEmbeddings({ ...embeddings(), vectors: [] })).toBeNull();
  });

  it("drops entries whose vector length disagrees with dims or that are malformed", () => {
    const raw: unknown = {
      ...embeddings(),
      vectors: {
        1: entry(),
        2: entry({ vector: [1] }), // wrong dims
        3: entry({ vector: [1, "x"] as unknown as number[] }), // non-number element
        4: { vector: [1, 0], embeddedAt: NOW }, // missing title
        5: { title: "t", vector: [1, 0] }, // missing embeddedAt
        6: "garbage",
      },
    };
    expect(coerceTabEmbeddings(raw)?.vectors).toEqual({ 1: entry() });
  });

  it("drops non-integer and non-positive tab ids", () => {
    const raw: unknown = {
      ...embeddings(),
      vectors: { "1.5": entry(), "0": entry(), "-2": entry(), 7: entry() },
    };
    expect(Object.keys(coerceTabEmbeddings(raw)!.vectors)).toEqual(["7"]);
  });

  it("returns null when no entries survive", () => {
    expect(coerceTabEmbeddings({ ...embeddings(), vectors: {} })).toBeNull();
  });
});

// ─── TabEmbeddingCache.get ───────────────────────────────────────────────────

describe("TabEmbeddingCache.get", () => {
  const cache = TabEmbeddingCache.fromStorage(embeddings());

  it("returns the fresh vector for the right model + text", () => {
    expect(cache.get(MODEL, 1, "Launch notes example.com", NOW)).toEqual([1, 0]);
  });

  it("returns undefined when missing, model-mismatched, or the title changed", () => {
    expect(cache.get(MODEL, 99, "x", NOW)).toBeUndefined();
    expect(cache.get("other-model", 1, "Launch notes example.com", NOW)).toBeUndefined();
    expect(cache.get(MODEL, 1, "Renamed tab example.com", NOW)).toBeUndefined();
  });

  it("enforces the 24 h embed TTL (fresh exactly at TTL, stale after)", () => {
    expect(EMBED_TTL_MS).toBe(TASK_TTL_MS.embed);
    expect(EMBED_TTL_MS).toBe(DAY);
    expect(cache.get(MODEL, 1, "Launch notes example.com", NOW + EMBED_TTL_MS)).toEqual([1, 0]);
    expect(cache.get(MODEL, 1, "Launch notes example.com", NOW + EMBED_TTL_MS + 1)).toBeUndefined();
  });
});

// ─── TabEmbeddingCache.set / vectorsFor / prune ──────────────────────────────

describe("TabEmbeddingCache.set", () => {
  it("upserts an entry and keeps the rest", () => {
    const next = TabEmbeddingCache.empty().set(MODEL, 1, "a", [1, 0], NOW);
    const updated = next.set(MODEL, 1, "b", [0, 1], NOW + 5);
    const withOther = updated.set(MODEL, 2, "c", [1, 1], NOW + 5);
    expect(updated.get(MODEL, 1, "a", NOW + 5)).toBeUndefined(); // title changed
    expect(updated.get(MODEL, 1, "b", NOW + 5)).toEqual([0, 1]);
    expect(withOther.get(MODEL, 2, "c", NOW + 5)).toEqual([1, 1]);
  });

  it("starts a fresh envelope under a different model (re-embed on model change)", () => {
    const cache = TabEmbeddingCache.empty().set(MODEL, 1, "a", [1, 0], NOW);
    const switched = cache.set("new-model", 1, "a", [1, 0, 0], NOW);
    expect(switched.toJSON()?.model).toBe("new-model");
    expect(switched.toJSON()?.dims).toBe(3);
    expect(switched.get("new-model", 1, "a", NOW)).toEqual([1, 0, 0]);
    expect(Object.keys(switched.toJSON()!.vectors)).toEqual(["1"]);
  });

  it("rejects zero-length vectors", () => {
    const cache = TabEmbeddingCache.empty().set(MODEL, 1, "a", [1, 0], NOW);
    expect(cache.set(MODEL, 2, "b", [], NOW).get(MODEL, 2, "b", NOW)).toBeUndefined();
  });
});

describe("TabEmbeddingCache.vectorsFor", () => {
  const cache = TabEmbeddingCache.fromStorage(embeddings());

  it("returns fresh vectors for the current model, keyed by tab id", () => {
    expect(cache.vectorsFor(MODEL, NOW)).toEqual(
      new Map([
        [1, [1, 0]],
        [2, [0.5, 0.5]],
      ]),
    );
  });

  it("returns an empty map for a different model", () => {
    expect(cache.vectorsFor("other-model", NOW)).toEqual(new Map());
  });

  it("excludes expired entries", () => {
    const vectors = cache.vectorsFor(MODEL, NOW + EMBED_TTL_MS + 1);
    expect(vectors).toEqual(new Map());
  });
});

describe("TabEmbeddingCache.prune", () => {
  it("drops entries for closed tabs and returns `this` when nothing drops", () => {
    const cache = TabEmbeddingCache.fromStorage(embeddings());
    const pruned = cache.prune(new Set([1]));
    expect(pruned.toJSON()?.vectors).toEqual({ 1: entry() });
    expect(cache.prune(new Set([1, 2]))).toBe(cache);
    const empty = TabEmbeddingCache.empty();
    expect(empty.prune(new Set([1]))).toBe(empty);
  });
});

// ─── ensureTabEmbeddings ─────────────────────────────────────────────────────

describe("ensureTabEmbeddings", () => {
  const tabs = [
    { id: 1, title: "Launch notes", domain: "example.com" },
    { id: 2, title: "Roadmap", domain: "roadmap.com" },
  ];

  function stubFetch(ok: boolean, body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok,
        status: ok ? 200 : 500,
        text: async () => body,
      })),
    );
  }

  it("returns the same cache instance when nothing is stale", async () => {
    stubFetch(true, JSON.stringify({ embeddings: [] }));
    const cache = TabEmbeddingCache.fromStorage(embeddings());
    await expect(ensureTabEmbeddings(tabs, MODEL, cache, NOW)).resolves.toBe(cache);
  });

  it("batch-embeds only the stale texts and stores them title-keyed", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { body?: string }) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ embeddings: [[0, 1]] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Tab 1 is fresh; tab 2 changed title ("Roadmap roadmap.com" → "Q3 plan roadmap.com").
    const cache = TabEmbeddingCache.fromStorage(embeddings());
    const staleTab = { id: 2, title: "Q3 plan", domain: "roadmap.com" };
    const next = await ensureTabEmbeddings([tabs[0], staleTab], MODEL, cache, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!);
    expect(body.model).toBe(MODEL);
    expect(body.input).toEqual(["Q3 plan roadmap.com"]);
    expect(next.get(MODEL, 2, "Q3 plan roadmap.com", NOW)).toEqual([0, 1]);
    expect(next.get(MODEL, 1, "Launch notes example.com", NOW)).toEqual([1, 0]);
  });

  it("re-embeds everything when the model changed (whole-envelope invalidation)", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { body?: string }) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ embeddings: [[0, 1], [1, 1]] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const next = await ensureTabEmbeddings(tabs, "new-model", TabEmbeddingCache.fromStorage(embeddings()), NOW);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!);
    expect(body.input).toEqual(["Launch notes example.com", "Roadmap roadmap.com"]);
    expect(next.toJSON()?.model).toBe("new-model");
    expect(next.get("new-model", 1, "Launch notes example.com", NOW)).toEqual([0, 1]);
    expect(next.get("new-model", 2, "Roadmap roadmap.com", NOW)).toEqual([1, 1]);
  });

  it("prunes vectors for closed tabs on write", async () => {
    stubFetch(true, JSON.stringify({ embeddings: [] }));
    // Tab 2 closed: fresh cache containing it still gets pruned (instance changes).
    const cache = TabEmbeddingCache.fromStorage(embeddings());
    const next = await ensureTabEmbeddings([tabs[0]], MODEL, cache, NOW);
    expect(next).not.toBe(cache);
    expect(next.toJSON()?.vectors).toEqual({ 1: entry() });
  });

  it("throws when the transport fails or the count mismatches", async () => {
    stubFetch(false, "boom");
    await expect(ensureTabEmbeddings(tabs, MODEL, TabEmbeddingCache.empty(), NOW)).rejects.toThrow(
      "Ollama 500",
    );
    stubFetch(true, JSON.stringify({ embeddings: [[0, 1]] })); // 1 vector for 2 texts
    await expect(ensureTabEmbeddings(tabs, MODEL, TabEmbeddingCache.empty(), NOW)).rejects.toThrow(
      "Embedding count mismatch",
    );
  });
});

// ─── searchSemanticTabs ──────────────────────────────────────────────────────

describe("searchSemanticTabs", () => {
  it("returns top-k fresh matches gated on the cosine threshold", () => {
    const cache = TabEmbeddingCache.fromStorage(
      embeddings({ vectors: { 1: entry({ vector: [1, 0] }), 2: entry({ vector: [0, 1] }) } }),
    );
    const hits = searchSemanticTabs([1, 0], cache, MODEL, 8, 0.32, NOW);
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  it("excludes expired entries and respects the k limit", () => {
    const cache = TabEmbeddingCache.fromStorage(
      embeddings({ vectors: { 1: entry({ vector: [1, 0] }), 2: entry({ vector: [0.9, 0.1], embeddedAt: NOW - EMBED_TTL_MS - 1 }) } }),
    );
    const hits = searchSemanticTabs([1, 0], cache, MODEL, 8, 0.32, NOW);
    expect(hits.map((h) => h.id)).toEqual([1]);
    expect(searchSemanticTabs([1, 0], cache, MODEL, 1, 0.32, NOW)).toHaveLength(1);
  });
});

describe("constants", () => {
  it("uses the documented key and query debounce", () => {
    expect(AI_TAB_EMBEDDINGS_KEY).toBe("aiTabEmbeddings");
    expect(QUERY_DEBOUNCE_MS).toBe(250);
  });
});