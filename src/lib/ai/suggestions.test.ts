import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AI_SUGGESTIONS_KEY,
  SUGGESTION_REGEN_THRESHOLD,
  SUGGESTIONS_TTL_MS,
  SuggestionsCache,
  coerceSuggestions,
  generateSuggestions,
  parseSuggestions,
  type Suggestion,
  type Suggestions,
} from "./suggestions";
import { TASK_TTL_MS } from "./cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = 2_000_000_000_000;

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  goal: "Launch planning",
  tabIds: [1, 2, 3],
  reason: "all about the launch",
  ...over,
});

const plan = (over: Partial<Suggestions> = {}): Suggestions => ({
  signature: "sig-a",
  items: [suggestion()],
  generatedAt: NOW,
  model: "qwen2.5:3b",
  tabCount: 10,
  dismissed: false,
  ...over,
});

// ─── parseSuggestions ───────────────────────────────────────────────────────

describe("parseSuggestions", () => {
  it("parses a clean plan and keeps only valid ids", () => {
    const text = JSON.stringify({
      suggestions: [
        suggestion(),
        suggestion({ goal: "Travel", tabIds: [4, 5], reason: "the trip" }),
      ],
    });
    expect(parseSuggestions(text, [1, 2, 3, 4, 5])).toEqual([
      suggestion(),
      suggestion({ goal: "Travel", tabIds: [4, 5], reason: "the trip" }),
    ]);
  });

  it("caps at 2 suggestions (the prompt contract) and recovers from fences", () => {
    const text =
      "Here you go:\n```json\n" +
      JSON.stringify({
        suggestions: [
          suggestion(),
          suggestion({ goal: "B" }),
          suggestion({ goal: "C" }),
        ],
      }) +
      "\n```";
    expect(parseSuggestions(text, [1, 2, 3])).toHaveLength(2);
  });

  it("skips suggestions with empty goals, reasons, no ids, or ids outside the open set", () => {
    const text = JSON.stringify({
      suggestions: [
        suggestion(),
        suggestion({ goal: "  " }),
        suggestion({ reason: "" }),
        suggestion({ tabIds: [] }),
        suggestion({ tabIds: [99] }), // not open
        suggestion({ tabIds: [0, 1] }), // 0 dropped, 1 kept
        "garbage",
        null,
      ],
    });
    expect(parseSuggestions(text, [1, 2, 3])).toEqual([
      suggestion(),
      suggestion({ tabIds: [1] }),
    ]);
  });

  it("returns null for garbage or when nothing survives validation", () => {
    expect(parseSuggestions("no json at all", [1])).toBeNull();
    expect(parseSuggestions('{"suggestions":[]}', [1])).toBeNull();
    expect(parseSuggestions('{"suggestions":[{"goal":"x","tabIds":[9],"reason":"r"}]}', [1])).toBeNull();
    expect(parseSuggestions("", [1])).toBeNull();
  });
});

// ─── coerceSuggestions ──────────────────────────────────────────────────────

describe("coerceSuggestions", () => {
  it("accepts a valid stored plan (dismissed true and false)", () => {
    expect(coerceSuggestions(plan())).toEqual(plan());
    expect(coerceSuggestions(plan({ dismissed: true }))).toEqual(
      plan({ dismissed: true }),
    );
  });

  it("rejects plans with missing or malformed envelope fields", () => {
    expect(coerceSuggestions(null)).toBeNull();
    expect(coerceSuggestions("x")).toBeNull();
    expect(coerceSuggestions([plan()])).toBeNull();
    expect(coerceSuggestions({ ...plan(), signature: 42 })).toBeNull();
    expect(coerceSuggestions({ ...plan(), generatedAt: "yesterday" })).toBeNull();
    expect(coerceSuggestions({ ...plan(), model: undefined })).toBeNull();
    expect(coerceSuggestions({ ...plan(), tabCount: "ten" })).toBeNull();
  });

  it("defaults dismissed to false and drops malformed items", () => {
    const raw = {
      ...plan(),
      dismissed: "yes",
      items: [
        suggestion(),
        { goal: "", tabIds: [1], reason: "r" },
        { goal: "g", tabIds: [], reason: "r" },
        "garbage",
      ],
    };
    const coerced = coerceSuggestions(raw);
    expect(coerced?.dismissed).toBe(false);
    expect(coerced?.items).toEqual([suggestion()]);
  });

  it("rejects a plan with no surviving items", () => {
    expect(coerceSuggestions({ ...plan(), items: [] })).toBeNull();
  });
});

// ─── SuggestionsCache ───────────────────────────────────────────────────────

describe("SuggestionsCache", () => {
  it("stores and returns a fresh plan for the right signature + model", () => {
    const cache = SuggestionsCache.empty().set(plan());
    expect(cache.get("sig-a", "qwen2.5:3b", 10, NOW)).toEqual(plan());
  });

  it("rejects plans for a different model and applies the 30-min TTL", () => {
    const cache = SuggestionsCache.empty().set(plan());
    expect(cache.get("sig-a", "llama3.1:8b", 10, NOW)).toBeUndefined();
    expect(SUGGESTIONS_TTL_MS).toBe(TASK_TTL_MS.suggestions);
    const halfHour = 30 * 60_000;
    expect(cache.get("sig-a", "qwen2.5:3b", 10, NOW + halfHour)).toBeDefined();
    expect(cache.get("sig-a", "qwen2.5:3b", 10, NOW + halfHour + 1)).toBeUndefined();
  });

  it("keeps the cached plan under small tab churn (< 5 tabs)", () => {
    const cache = SuggestionsCache.empty().set(plan({ tabCount: 10 }));
    expect(cache.get("sig-other", "qwen2.5:3b", 13, NOW)).toEqual(plan({ tabCount: 10 }));
    expect(cache.get("sig-other", "qwen2.5:3b", 14, NOW)).toEqual(plan({ tabCount: 10 }));
  });

  it("regenerates when the tab set changed by >= SUGGESTION_REGEN_THRESHOLD", () => {
    const cache = SuggestionsCache.empty().set(plan({ tabCount: 10 }));
    expect(cache.get("sig-other", "qwen2.5:3b", 15, NOW)).toBeUndefined();
    expect(cache.get("sig-other", "qwen2.5:3b", 5, NOW)).toBeUndefined();
    expect(SUGGESTION_REGEN_THRESHOLD).toBe(5);
  });

  it("set replaces the previous plan, clear empties, fromStorage coerces disk", () => {
    const next = SuggestionsCache.empty().set(plan()).set(plan({ signature: "sig-b" }));
    expect(next.toJSON()?.signature).toBe("sig-b");
    expect(next.clear().toJSON()).toBeNull();
    expect(SuggestionsCache.fromStorage(plan()).get("sig-a", "qwen2.5:3b", 10, NOW)).toEqual(plan());
    expect(SuggestionsCache.fromStorage(null).toJSON()).toBeNull();
  });
});

// ─── generateSuggestions ────────────────────────────────────────────────────

describe("generateSuggestions", () => {
  const tabs = [
    { id: 1, title: "Launch notes", domain: "docs.dev", windowId: 1 },
    { id: 2, title: "Roadmap", domain: "roadmap.com", windowId: 1 },
    { id: 3, title: "Pricing page", domain: "shop.com", windowId: 2 },
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

  it("returns parsed suggestions from the fast-tier transport", async () => {
    stubFetch(
      true,
      JSON.stringify({
        response: JSON.stringify({
          suggestions: [
            { goal: "Launch", tabIds: [1, 2], reason: "prep work" },
            { goal: "Shopping", tabIds: [3], reason: "checkout" },
          ],
        }),
      }),
    );
    await expect(generateSuggestions(tabs, "qwen2.5:3b")).resolves.toEqual([
      { goal: "Launch", tabIds: [1, 2], reason: "prep work" },
      { goal: "Shopping", tabIds: [3], reason: "checkout" },
    ]);
  });

  it("asks for JSON mode with the fast context window", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { method?: string; body?: string }) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: '{"suggestions":[]}' }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateSuggestions(tabs, "qwen2.5:3b").catch(() => {});
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!);
    expect(body.model).toBe("qwen2.5:3b");
    expect(body.format).toBe("json");
    expect(body.options.num_ctx).toBe(4096);
  });

  it("throws when the output is unparseable or the transport fails", async () => {
    stubFetch(true, JSON.stringify({ response: "sorry, no json" }));
    await expect(generateSuggestions(tabs, "m")).rejects.toThrow("Suggestions output");
    stubFetch(false, "boom");
    await expect(generateSuggestions(tabs, "m")).rejects.toThrow("Ollama 500");
  });
});

describe("storage key", () => {
  it("is the documented key", () => {
    expect(AI_SUGGESTIONS_KEY).toBe("aiSuggestions");
  });
});