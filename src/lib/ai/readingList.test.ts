import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AI_READING_LIST_KEY,
  READING_LIST_CAP,
  SUMMARIZE_PAGE_TTL_MS,
  ReadingList,
  coerceReadingList,
  composeSummary,
  entryId,
  generatePageSummary,
  parseSummarizePage,
  type ReadingEntry,
} from "./readingList";
import { TASK_TTL_MS, DAY } from "./cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = 2_000_000_000_000;

const entry = (over: Partial<ReadingEntry> = {}): ReadingEntry => ({
  id: "abc123",
  url: "https://example.com/article",
  title: "An article",
  summary: "- Bullet one\n- Bullet two\nIt mattered because…",
  savedAt: NOW,
  ...over,
});

// ─── entryId / parse / compose ───────────────────────────────────────────────

describe("entryId", () => {
  it("is content-addressed: same title+text → same id, different text → different id", () => {
    expect(entryId("T", "same text")).toBe(entryId("T", "same text"));
    expect(entryId("T", "same text")).not.toBe(entryId("T", "other text"));
    expect(entryId("T", "same text")).not.toBe(entryId("Other", "same text"));
  });
});

describe("parseSummarizePage", () => {
  it("parses a clean response", () => {
    expect(
      parseSummarizePage('{"summary":"- Bullet\\n- Bullet","whyItMatters":"The launch."}'),
    ).toEqual({ summary: "- Bullet\n- Bullet", whyItMatters: "The launch." });
  });

  it("recovers JSON from code fences and tolerates a missing whyItMatters", () => {
    expect(parseSummarizePage('```json\n{"summary":"S"}\n```')).toEqual({
      summary: "S",
      whyItMatters: "",
    });
  });

  it("returns null for garbage or an empty summary", () => {
    expect(parseSummarizePage("no json")).toBeNull();
    expect(parseSummarizePage('{"whyItMatters":"x"}')).toBeNull();
    expect(parseSummarizePage('{"summary":"   "}')).toBeNull();
    expect(parseSummarizePage("")).toBeNull();
  });
});

describe("composeSummary", () => {
  it("appends the why-it-mattered line when present", () => {
    expect(composeSummary("S", "W")).toBe("S\nW");
  });

  it("returns the summary alone when there is no why line", () => {
    expect(composeSummary("S", "")).toBe("S");
  });
});

// ─── coerceReadingList ───────────────────────────────────────────────────────

describe("coerceReadingList", () => {
  it("coerces a list, dropping malformed rows", () => {
    const raw = [
      entry(),
      { id: "x", url: "u", title: "t", summary: "  ", savedAt: 1 }, // empty summary
      { id: "x", url: "u", title: "t", summary: "s", savedAt: "yesterday" }, // bad savedAt
      { id: "x", url: "u", title: "t" }, // missing savedAt
      "garbage",
      null,
      entry({ id: "ok", title: "Kept" }),
    ];
    expect(coerceReadingList(raw).map((e) => e.id)).toEqual(["abc123", "ok"]);
  });

  it("returns [] for non-arrays and caps at READING_LIST_CAP (newest kept)", () => {
    expect(coerceReadingList(null)).toEqual([]);
    expect(coerceReadingList("x")).toEqual([]);
    const tooMany = Array.from({ length: READING_LIST_CAP + 20 }, (_, i) =>
      entry({ id: `id-${i}`, savedAt: NOW + i }),
    );
    const coerced = coerceReadingList(tooMany);
    expect(coerced).toHaveLength(READING_LIST_CAP);
    expect(coerced[0].id).toBe("id-20");
  });
});

// ─── ReadingList ─────────────────────────────────────────────────────────────

describe("ReadingList", () => {
  it("add dedupes by content id, replaces in place, and caps at 100", () => {
    const list = ReadingList.empty().add(entry());
    const replaced = list.add(entry({ summary: "newer" }));
    expect(replaced.toArray()).toHaveLength(1);
    expect(replaced.find(entry().id)?.summary).toBe("newer");
    const many = Array.from({ length: READING_LIST_CAP + 5 }, (_, i) =>
      entry({ id: `id-${i}`, savedAt: NOW + i }),
    );
    const capped = many.reduce((l, e) => l.add(e), ReadingList.empty());
    expect(capped.toArray()).toHaveLength(READING_LIST_CAP);
    expect(capped.find("id-0")).toBeUndefined();
    expect(capped.find(`id-${READING_LIST_CAP + 4}`)).toBeDefined();
  });

  it("remove drops only the matching id; findFresh enforces the 7-day TTL", () => {
    const list = ReadingList.fromStorage([entry(), entry({ id: "keep", title: "K" })]);
    expect(list.remove("abc123").find("abc123")).toBeUndefined();
    expect(list.remove("abc123").find("keep")).toBeDefined();
    expect(SUMMARIZE_PAGE_TTL_MS).toBe(TASK_TTL_MS.summarizePage);
    expect(SUMMARIZE_PAGE_TTL_MS).toBe(7 * DAY);
    expect(list.findFresh("abc123", NOW + 7 * DAY)).toBeDefined();
    expect(list.findFresh("abc123", NOW + 7 * DAY + 1)).toBeUndefined();
  });

  it("fromStorage coerces disk and empty is empty", () => {
    expect(ReadingList.fromStorage("garbage").toJSON()).toEqual([]);
    expect(ReadingList.empty().toJSON()).toEqual([]);
  });
});

// ─── generatePageSummary ─────────────────────────────────────────────────────

describe("generatePageSummary", () => {
  const page = { title: "An article", text: "Lots of body text…" };

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
      JSON.stringify({
        response: JSON.stringify({ summary: "- Bullet", whyItMatters: "The launch." }),
      }),
    );
    await expect(generatePageSummary(page, "qwen2.5:7b")).resolves.toEqual({
      summary: "- Bullet",
      whyItMatters: "The launch.",
    });
  });

  it("asks for JSON mode with the chat context window", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { body?: string }) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: '{"summary":"S","whyItMatters":"W"}' }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generatePageSummary(page, "qwen2.5:7b");
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body!);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.format).toBe("json");
    expect(body.options.num_ctx).toBe(8192);
  });

  it("throws when the output is unparseable or the transport fails", async () => {
    stubFetch(true, JSON.stringify({ response: "sorry" }));
    await expect(generatePageSummary(page, "m")).rejects.toThrow("Page summary output");
    stubFetch(false, "boom");
    await expect(generatePageSummary(page, "m")).rejects.toThrow("Ollama 500");
  });
});

describe("constants", () => {
  it("uses the documented key and cap", () => {
    expect(AI_READING_LIST_KEY).toBe("aiReadingList");
    expect(READING_LIST_CAP).toBe(100);
  });
});