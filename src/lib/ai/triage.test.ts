import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AI_TRIAGE_KEY,
  IDLE_DISMISS_KEY,
  TRIAGE_TTL_MS,
  TriageCache,
  coerceTriagePlan,
  generateTriage,
  parseTriagePlan,
  triageCandidates,
  type TriageItem,
  type TriagePlan,
} from "./triage";
import { TRIAGE_TAB_CAP } from "./prompts";
import { DEFAULT_SETTINGS, type AppSettings, type EnrichedTab } from "../../types/index";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = 2_000_000_000_000;

const tab = (over: Partial<EnrichedTab> = {}): EnrichedTab => ({
  id: 1,
  windowId: 1,
  url: "https://a.com/1",
  title: "A",
  favIconUrl: "",
  domain: "a.com",
  openedAt: NOW - 60_000,
  lastActiveAt: NOW - 60_000,
  totalActiveTime: 0,
  visitCount: 1,
  isVisited: true,
  isPinned: false,
  groupId: null,
  groupName: null,
  groupColor: null,
  isHibernated: false,
  tags: [],
  ...over,
});

const settings: AppSettings = { ...DEFAULT_SETTINGS, zombieThresholdHours: 3 };

const item = (over: Partial<TriageItem> = {}): TriageItem => ({
  tabId: 1,
  reason: "not touched in weeks",
  action: "close",
  category: "stale",
  ...over,
});

// ─── triageCandidates ───────────────────────────────────────────────────────

describe("triageCandidates", () => {
  it("unions forgotten, zombie and unvisited tabs without duplicates", () => {
    const forgotten = tab({ id: 1, lastActiveAt: NOW - 25 * 3_600_000 });
    const zombie = tab({ id: 2, lastActiveAt: NOW - 4 * 3_600_000 });
    const unvisited = tab({
      id: 3,
      visitCount: 0,
      openedAt: NOW - 45 * 60_000,
      lastActiveAt: NOW - 10 * 60_000,
    });
    const both = tab({ id: 4, lastActiveAt: NOW - 30 * 3_600_000, visitCount: 0 });
    const fresh = tab({ id: 5 });
    const ids = triageCandidates([fresh, both, forgotten, zombie, unvisited], settings, NOW).map((t) => t.id);
    // forgotten (in input order), then zombies, then unvisited — deduped
    expect(ids).toEqual([both.id, forgotten.id, zombie.id, unvisited.id]);
  });

  it("never includes pinned tabs", () => {
    const pinnedForgotten = tab({ id: 7, isPinned: true, lastActiveAt: NOW - 25 * 3_600_000 });
    const candidates = triageCandidates([pinnedForgotten], settings, NOW);
    expect(candidates).toEqual([]);
  });

  it("caps at TRIAGE_TAB_CAP, forgotten first", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      tab({ id: i + 1, lastActiveAt: NOW - 25 * 3_600_000 }),
    );
    const candidates = triageCandidates(many, settings, NOW);
    expect(candidates).toHaveLength(TRIAGE_TAB_CAP);
    expect(candidates[0].id).toBe(1);
    expect(candidates[TRIAGE_TAB_CAP - 1].id).toBe(TRIAGE_TAB_CAP);
  });

  it("is empty when everything is fresh and visited", () => {
    expect(triageCandidates([tab({ id: 1 })], settings, NOW)).toEqual([]);
  });
});

// ─── parseTriagePlan ────────────────────────────────────────────────────────

describe("parseTriagePlan", () => {
  it("parses a clean plan and keeps only valid ids", () => {
    const text = JSON.stringify({
      items: [
        item({ tabId: 1, category: "stale" }),
        item({ tabId: 2, action: "keep", category: "same-thread" }),
      ],
    });
    expect(parseTriagePlan(text, [1, 2])).toEqual([
      item({ tabId: 1, category: "stale" }),
      item({ tabId: 2, action: "keep", category: "same-thread" }),
    ]);
  });

  it("recovers JSON from code fences and prose", () => {
    const text = 'Here is the plan:\n```json\n{"items":[{"tabId":1,"reason":"r","action":"close","category":"junk"}]}\n```';
    expect(parseTriagePlan(text, [1])).toEqual([
      { tabId: 1, reason: "r", action: "close", category: "junk" },
    ]);
  });

  it("skips items with unknown actions, categories, empty reasons or bad ids", () => {
    const text = JSON.stringify({
      items: [
        item({ tabId: 1 }),
        item({ tabId: 2, action: "delete" as never }),
        item({ tabId: 3, category: "maybe" as never }),
        item({ tabId: 4, reason: "  " }),
        item({ tabId: 99 }), // not in validIds
        item({ tabId: 0 }),
        "garbage",
        null,
      ],
    });
    expect(parseTriagePlan(text, [1, 2, 3, 4])).toEqual([item({ tabId: 1 })]);
  });

  it("returns null for garbage or when nothing survives validation", () => {
    expect(parseTriagePlan("no json at all", [1])).toBeNull();
    expect(parseTriagePlan('{"items":[{"tabId":99,"reason":"r","action":"close","category":"junk"}]}', [1])).toBeNull();
    expect(parseTriagePlan('{"items":[]}', [1])).toBeNull();
    expect(parseTriagePlan("", [1])).toBeNull();
  });
});

// ─── coerceTriagePlan ───────────────────────────────────────────────────────

describe("coerceTriagePlan", () => {
  const plan: TriagePlan = {
    signature: "abc",
    items: [item()],
    generatedAt: NOW,
    source: "idle",
    model: "qwen2.5:3b",
  };

  it("accepts a valid stored plan", () => {
    expect(coerceTriagePlan(plan)).toEqual(plan);
  });

  it("rejects plans with missing or malformed envelope fields", () => {
    expect(coerceTriagePlan(null)).toBeNull();
    expect(coerceTriagePlan("x")).toBeNull();
    expect(coerceTriagePlan([plan])).toBeNull();
    expect(coerceTriagePlan({ ...plan, signature: 42 })).toBeNull();
    expect(coerceTriagePlan({ ...plan, generatedAt: "yesterday" })).toBeNull();
    expect(coerceTriagePlan({ ...plan, source: "background" })).toBeNull();
    expect(coerceTriagePlan({ ...plan, model: undefined })).toBeNull();
  });

  it("drops malformed items but keeps valid ones", () => {
    const raw = {
      ...plan,
      items: [
        item(),
        { tabId: 2, reason: "", action: "close", category: "stale" },
        { tabId: 3, action: "close", category: "nope" },
        "garbage",
      ],
    };
    expect(coerceTriagePlan(raw)?.items).toEqual([item()]);
  });

  it("rejects a plan with no surviving items", () => {
    expect(coerceTriagePlan({ ...plan, items: [] })).toBeNull();
  });
});

// ─── TriageCache ────────────────────────────────────────────────────────────

describe("TriageCache", () => {
  const onDemand: TriagePlan = {
    signature: "sig-a",
    items: [item()],
    generatedAt: NOW,
    source: "on-demand",
    model: "qwen2.5:3b",
  };
  const idle: TriagePlan = {
    signature: "sig-b",
    items: [item()],
    generatedAt: NOW,
    source: "idle",
    model: "qwen2.5:3b",
  };

  it("stores and returns a fresh plan for the right signature + model", () => {
    const cache = TriageCache.empty().set(onDemand);
    expect(cache.get("sig-a", "qwen2.5:3b", NOW)).toEqual(onDemand);
  });

  it("rejects plans for a different signature or model", () => {
    const cache = TriageCache.empty().set(onDemand);
    expect(cache.get("sig-other", "qwen2.5:3b", NOW)).toBeUndefined();
    expect(cache.get("sig-a", "llama3.1:8b", NOW)).toBeUndefined();
  });

  it("applies the per-source TTL: 1 h on-demand, 2 h idle", () => {
    const hour = 3_600_000;
    expect(TRIAGE_TTL_MS["on-demand"]).toBe(hour);
    expect(TRIAGE_TTL_MS.idle).toBe(2 * hour);

    expect(TriageCache.empty().set(onDemand).get("sig-a", "qwen2.5:3b", NOW + hour)).toBeDefined();
    expect(TriageCache.empty().set(onDemand).get("sig-a", "qwen2.5:3b", NOW + hour + 1)).toBeUndefined();

    // An idle draft is still fresh past the on-demand TTL…
    expect(TriageCache.empty().set(idle).get("sig-b", "qwen2.5:3b", NOW + hour + 30 * 60_000)).toBeDefined();
    // …but expires at its own 2 h TTL.
    expect(TriageCache.empty().set(idle).get("sig-b", "qwen2.5:3b", NOW + 2 * hour + 1)).toBeUndefined();
  });

  it("idlePlan returns only fresh idle-sourced drafts", () => {
    expect(TriageCache.empty().set(idle).idlePlan(NOW)).toEqual(idle);
    expect(TriageCache.empty().set(idle).idlePlan(NOW + 2 * 3_600_000 + 1)).toBeUndefined();
    expect(TriageCache.empty().set(onDemand).idlePlan(NOW)).toBeUndefined();
    expect(TriageCache.empty().idlePlan(NOW)).toBeUndefined();
  });

  it("set replaces the previous plan and clear empties", () => {
    const next = TriageCache.empty().set(onDemand).set(idle);
    expect(next.toJSON()).toEqual(idle);
    expect(next.clear().toJSON()).toBeNull();
  });

  it("fromStorage coerces disk values (round-trips the SW idle write)", () => {
    const cache = TriageCache.fromStorage(idle);
    expect(cache.get("sig-b", "qwen2.5:3b", NOW)).toEqual(idle);
    expect(TriageCache.fromStorage(null).toJSON()).toBeNull();
  });
});

// ─── generateTriage ─────────────────────────────────────────────────────────

describe("generateTriage", () => {
  const candidates = [
    { id: 1, title: "Stale docs", domain: "docs.dev", openedAt: NOW - 3_600_000, visitCount: 1 },
    { id: 2, title: "Old checkout", domain: "shop.com", openedAt: NOW - 86_400_000, visitCount: 0 },
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

  it("returns parsed items from the fast-tier transport", async () => {
    stubFetch(
      true,
      JSON.stringify({
        response: JSON.stringify({
          items: [
            { tabId: 2, reason: "abandoned cart", action: "close", category: "stale" },
            { tabId: 1, reason: "still reading", action: "keep", category: "same-thread" },
          ],
        }),
      }),
    );
    await expect(generateTriage(candidates, "qwen2.5:3b")).resolves.toEqual([
      { tabId: 2, reason: "abandoned cart", action: "close", category: "stale" },
      { tabId: 1, reason: "still reading", action: "keep", category: "same-thread" },
    ]);
  });

  it("asks for JSON mode with the fast context window", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { method?: string; body?: string }) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: '{"items":[]}' }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateTriage(candidates, "qwen2.5:3b").catch(() => {});
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!);
    expect(body.model).toBe("qwen2.5:3b");
    expect(body.format).toBe("json");
    expect(body.options.num_ctx).toBe(4096);
  });

  it("throws when the output is unparseable or the transport fails", async () => {
    stubFetch(true, JSON.stringify({ response: "sorry, no json" }));
    await expect(generateTriage(candidates, "m")).rejects.toThrow("Triage output");
    stubFetch(false, "boom");
    await expect(generateTriage(candidates, "m")).rejects.toThrow("Ollama 500");
  });
});

describe("storage keys", () => {
  it("are the documented keys", () => {
    expect(AI_TRIAGE_KEY).toBe("aiTriagePlan");
    expect(IDLE_DISMISS_KEY).toBe("aiIdleDraftDismissedAt");
  });
});