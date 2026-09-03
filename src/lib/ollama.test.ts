import { describe, it, expect, vi } from "vitest";
import { buildClassifyPrompt, parseRelevantIds, generate } from "./ollama";

describe("buildClassifyPrompt", () => {
  it("includes the goal and every tab id/title/domain", () => {
    const p = buildClassifyPrompt("japan trip", [
      { id: 1, title: "Tokyo flights", domain: "google.com" },
      { id: 2, title: "AWS", domain: "aws.amazon.com" },
    ]);
    expect(p).toContain('Goal: "japan trip"');
    expect(p).toContain("1: Tokyo flights (google.com)");
    expect(p).toContain("2: AWS (aws.amazon.com)");
    expect(p).toMatch(/ONLY JSON/);
  });
});

describe("parseRelevantIds", () => {
  const valid = [1, 2, 3];
  it("parses {keep:[...]} JSON", () => {
    expect(parseRelevantIds('{"keep":[1,3]}', valid)).toEqual([1, 3]);
  });
  it("parses a bare array", () => {
    expect(parseRelevantIds("[2,3]", valid)).toEqual([2, 3]);
  });
  it("drops ids not in the valid set", () => {
    expect(parseRelevantIds('{"keep":[1,99]}', valid)).toEqual([1]);
  });
  it("falls back to extracting numbers from messy output", () => {
    expect(parseRelevantIds("keep tabs 2 and 3 please", valid)).toEqual([2, 3]);
  });
  it("returns [] on garbage", () => {
    expect(parseRelevantIds("no numbers here", valid)).toEqual([]);
  });
});

describe("generate", () => {
  function stubFetch(ok: boolean, body: string) {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: { body?: string }) => {
        captured = {
          url: String(url),
          body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
        };
        return {
          ok,
          status: ok ? 200 : 404,
          text: async () => body,
        };
      }),
    );
    return () => captured;
  }

  it("posts a JSON-mode generate request with the chat context window", async () => {
    const captured = stubFetch(true, JSON.stringify({ response: '{"summary":"hi"}' }));
    const out = await generate("prompt", "qwen2.5:7b-instruct-q4_K_M");
    expect(out).toBe('{"summary":"hi"}');
    expect(captured()?.url).toContain("/api/generate");
    expect(captured()?.body.format).toBe("json");
    expect(captured()?.body.model).toBe("qwen2.5:7b-instruct-q4_K_M");
    expect(captured()?.body.prompt).toBe("prompt");
    expect((captured()?.body.options as { num_ctx: number }).num_ctx).toBe(8192);
    vi.unstubAllGlobals();
  });

  it("uses the fast tier context window for fast tasks", async () => {
    const captured = stubFetch(true, "{}");
    await generate("prompt", "qwen2.5:3b-instruct-q4_K_M", "fast");
    expect((captured()?.body.options as { num_ctx: number }).num_ctx).toBe(4096);
    vi.unstubAllGlobals();
  });

  it("throws on a non-OK response", async () => {
    stubFetch(false, "not found");
    await expect(generate("prompt", "missing-model")).rejects.toThrow("Ollama 404");
    vi.unstubAllGlobals();
  });
});
