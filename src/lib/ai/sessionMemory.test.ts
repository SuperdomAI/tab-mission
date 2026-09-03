import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AI_SESSION_SUMMARIES_KEY,
  SESSION_SUMMARY_TTL_MS,
  SessionSummaryCache,
  coerceSessionSummaries,
  generateSessionSummary,
  parseSessionSummary,
  summarizeSession,
  type SessionSummaryEntry,
} from "./sessionMemory";
import { TASK_TTL_MS } from "./cache";
import { DEFAULT_SETTINGS, type SavedSession } from "../../types/index";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = 2_000_000_000_000;

const entry = (over: Partial<SessionSummaryEntry> = {}): SessionSummaryEntry => ({
  summary: "This session covered the launch plan and pricing.",
  generatedAt: NOW,
  model: "qwen2.5:7b",
  ...over,
});

const session: SavedSession = {
  id: "session-1",
  name: "Launch planning",
  savedAt: NOW,
  tabs: [
    { title: "Roadmap", url: "https://roadmap.com", favIconUrl: "" },
    { title: "Pricing", url: "https://shop.com/pricing", favIconUrl: "" },
  ],
};

function chromeMock() {
  return (globalThis as unknown as { chrome: typeof chrome }).chrome;
}

type MockFn = ReturnType<typeof vi.fn>;

/** The chrome mock's storage fns, cast to vi.fn so tests can stub them. */
function storageFns() {
  const c = chromeMock();
  return {
    syncGet: c.storage.sync.get as unknown as MockFn,
    localGet: c.storage.local.get as unknown as MockFn,
    localSet: c.storage.local.set as unknown as MockFn,
  };
}

// ─── parseSessionSummary ────────────────────────────────────────────────────

describe("parseSessionSummary", () => {
  it("parses a clean summary", () => {
    expect(parseSessionSummary('{"summary":"This session covered docs."}')).toBe(
      "This session covered docs.",
    );
  });

  it("recovers JSON from code fences and prose", () => {
    expect(
      parseSessionSummary('Here you go:\n```json\n{"summary":"Five lines max"}\n```'),
    ).toBe("Five lines max");
  });

  it("returns null for garbage or empty summaries", () => {
    expect(parseSessionSummary("no json at all")).toBeNull();
    expect(parseSessionSummary('{"summary":"  "}')).toBeNull();
    expect(parseSessionSummary('{"other":"x"}')).toBeNull();
    expect(parseSessionSummary("")).toBeNull();
  });
});

// ─── coerceSessionSummaries ─────────────────────────────────────────────────

describe("coerceSessionSummaries", () => {
  it("coerces a map, dropping malformed rows", () => {
    const raw = {
      "session-1": entry(),
      "session-2": { summary: "  ", generatedAt: NOW, model: "m" },
      "session-3": { summary: "ok", generatedAt: "yesterday", model: "m" },
      "session-4": "garbage",
    };
    expect(coerceSessionSummaries(raw)).toEqual({ "session-1": entry() });
  });

  it("returns an empty map for non-objects", () => {
    expect(coerceSessionSummaries(null)).toEqual({});
    expect(coerceSessionSummaries([])).toEqual({});
    expect(coerceSessionSummaries("x")).toEqual({});
  });
});

// ─── SessionSummaryCache ────────────────────────────────────────────────────

describe("SessionSummaryCache", () => {
  it("returns a fresh entry for the right id + model (30-day TTL)", () => {
    const cache = SessionSummaryCache.fromStorage({ "session-1": entry() });
    expect(cache.get("session-1", "qwen2.5:7b", NOW)).toEqual(entry());
    expect(SESSION_SUMMARY_TTL_MS).toBe(TASK_TTL_MS.sessionSummary);
    const thirtyDays = 30 * 24 * 3_600_000;
    expect(cache.get("session-1", "qwen2.5:7b", NOW + thirtyDays)).toBeDefined();
    expect(cache.get("session-1", "qwen2.5:7b", NOW + thirtyDays + 1)).toBeUndefined();
  });

  it("rejects entries for a different model", () => {
    const cache = SessionSummaryCache.fromStorage({ "session-1": entry() });
    expect(cache.get("session-1", "llama3.1:8b", NOW)).toBeUndefined();
  });

  it("entry and map expose raw values for display/search", () => {
    const cache = SessionSummaryCache.fromStorage({ "session-1": entry() });
    expect(cache.entry("session-1")).toEqual(entry());
    expect(cache.entry("missing")).toBeUndefined();
    expect(cache.map()).toEqual({ "session-1": entry() });
  });

  it("set replaces an entry and prunes rows older than 30 days", () => {
    const stale = entry({ summary: "old", generatedAt: NOW - 31 * 24 * 3_600_000 });
    const cache = SessionSummaryCache.fromStorage({ "session-old": stale }).set(
      "session-1",
      "new summary",
      "qwen2.5:7b",
      NOW,
    );
    const json = cache.toJSON();
    expect(json["session-1"]).toEqual(entry({ summary: "new summary" }));
    expect(json["session-old"]).toBeUndefined();
  });
});

// ─── generateSessionSummary ─────────────────────────────────────────────────

describe("generateSessionSummary", () => {
  const lite = { name: session.name, tabs: session.tabs.map((t) => ({ title: t.title, url: t.url })) };

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

  it("returns the parsed summary from the chat-tier transport", async () => {
    stubFetch(
      true,
      JSON.stringify({ response: JSON.stringify({ summary: "Covered the launch." }) }),
    );
    await expect(generateSessionSummary(lite, "qwen2.5:7b")).resolves.toBe(
      "Covered the launch.",
    );
  });

  it("asks for JSON mode with the chat context window", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { method?: string; body?: string }) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: '{"summary":"x"}' }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateSessionSummary(lite, "qwen2.5:7b");
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.format).toBe("json");
    expect(body.options.num_ctx).toBe(8192);
  });

  it("throws when the output is unparseable or the transport fails", async () => {
    stubFetch(true, JSON.stringify({ response: "sorry" }));
    await expect(generateSessionSummary(lite, "m")).rejects.toThrow("Session summary output");
    stubFetch(false, "boom");
    await expect(generateSessionSummary(lite, "m")).rejects.toThrow("Ollama 500");
  });
});

// ─── summarizeSession (the shared UI/SW orchestrator) ───────────────────────

describe("summarizeSession", () => {
  it("gates on the AI master + aiSessionMemory toggles (no fetch when off)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await summarizeSession(session, true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageFns().localSet).not.toHaveBeenCalled();
  });

  it("writes aiSessionSummaries and backfills SavedSession.summary when AI is on", async () => {
    const { syncGet, localGet, localSet } = storageFns();
    syncGet.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, ollamaEnabled: true, aiSessionMemory: true },
    });
    localGet.mockImplementation((key: string) => {
      if (key === AI_SESSION_SUMMARIES_KEY) return Promise.resolve({});
      if (key === "sessions") return Promise.resolve({ sessions: [session] });
      return Promise.resolve({});
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ response: JSON.stringify({ summary: "Covered the launch." }) }),
      })),
    );
    await summarizeSession(session, true);
    const sets = localSet.mock.calls.map((call) => call[0]);
    const mapWrite = sets.find((s) => AI_SESSION_SUMMARIES_KEY in s);
    expect(mapWrite?.[AI_SESSION_SUMMARIES_KEY]?.[session.id]).toMatchObject(
      entry({
        summary: "Covered the launch.",
        model: DEFAULT_SETTINGS.aiChatModel,
        generatedAt: expect.any(Number),
      }),
    );
    const sessionsWrite = sets.find((s) => "sessions" in s);
    expect(sessionsWrite?.sessions?.[0]?.summary).toBe("Covered the launch.");
  });

  it("skips the backfill when the session is no longer in storage", async () => {
    const { syncGet, localGet, localSet } = storageFns();
    syncGet.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, ollamaEnabled: true, aiSessionMemory: true },
    });
    localGet.mockImplementation((key: string) => {
      if (key === AI_SESSION_SUMMARIES_KEY) return Promise.resolve({});
      if (key === "sessions") return Promise.resolve({ sessions: [] });
      return Promise.resolve({});
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: '{"summary":"gone"}' }),
      })),
    );
    await summarizeSession(session, true);
    const sets = localSet.mock.calls.map((call) => call[0]);
    expect(sets.some((s) => "sessions" in s)).toBe(false);
    expect(sets.some((s) => AI_SESSION_SUMMARIES_KEY in s)).toBe(true);
  });

  it("never throws — transport failures are logged and swallowed", async () => {
    const { syncGet } = storageFns();
    syncGet.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, ollamaEnabled: true, aiSessionMemory: true },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    await expect(summarizeSession(session, true)).resolves.toBeUndefined();
  });
});

describe("storage key", () => {
  it("is the documented key", () => {
    expect(AI_SESSION_SUMMARIES_KEY).toBe("aiSessionSummaries");
  });
});