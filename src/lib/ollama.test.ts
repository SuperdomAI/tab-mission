import { describe, it, expect, vi } from "vitest";
import {
  buildClassifyPrompt,
  parseRelevantIds,
  generate,
  streamChat,
  streamOllamaFetch,
} from "./ollama";
import { makeFakePort, type FakePort, type ChromeMock } from "../test/chrome-mock";

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

// ─── streaming chat (Ask AI sidebar) — ADDED, existing tests untouched ───────

describe("streamChat", () => {
  function chrome(): ChromeMock {
    return (globalThis as unknown as { chrome: ChromeMock }).chrome;
  }
  /** The fake port created by the Nth runtime.connect() call. */
  function portAt(index = 0): FakePort {
    const connect = chrome().runtime.connect as ReturnType<typeof vi.fn>;
    return connect.mock.results[index].value as FakePort;
  }
  function listenerOf(port: FakePort) {
    return port._onMessage.mock.calls[0][0] as (msg: unknown) => void;
  }
  function requestBody(port: FakePort): Record<string, unknown> {
    const sent = port.postMessage.mock.calls[0][0] as { init: { body: string } };
    return JSON.parse(sent.init.body) as Record<string, unknown>;
  }

  it("posts a stream request with tools and forwards deltas + tool calls", async () => {
    const deltas: string[] = [];
    const toolCalls: Array<[string, unknown]> = [];
    const promise = streamChat({
      messages: [{ role: "user", content: "hi" }],
      model: "qwen2.5:7b-instruct-q4_K_M",
      tools: [{ type: "function", function: { name: "closeTab" } }],
      onDelta: (d) => deltas.push(d),
      onToolCall: (name, args) => toolCalls.push([name, args]),
    });
    const port = portAt(0);
    expect(chrome().runtime.connect).toHaveBeenCalledWith({ name: "ollama-stream" });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stream-request", path: "/api/chat" }),
    );
    const body = requestBody(port);
    expect(body.stream).toBe(true);
    expect(body.tools).toHaveLength(1);
    expect(body.think).toBe(false);
    expect((body.options as { num_ctx: number }).num_ctx).toBe(8192);

    const listen = listenerOf(port);
    listen({ type: "chunk", data: JSON.stringify({ message: { content: "Hel" } }) });
    listen({
      type: "chunk",
      data: JSON.stringify({
        message: { tool_calls: [{ function: { name: "closeTab", arguments: '{"tabId":3}' } }] },
      }),
    });
    listen({ type: "done" });
    await promise;
    expect(deltas).toEqual(["Hel"]);
    expect(toolCalls).toEqual([["closeTab", { tabId: 3 }]]);
  });

  it("parses unparseable tool arguments as a raw string", async () => {
    const toolCalls: Array<[string, unknown]> = [];
    const promise = streamChat({
      messages: [],
      model: "m",
      onToolCall: (name, args) => toolCalls.push([name, args]),
    });
    const listen = listenerOf(portAt(0));
    listen({
      type: "chunk",
      data: JSON.stringify({
        message: { tool_calls: [{ function: { name: "closeTab", arguments: "not-json" } }] },
      }),
    });
    listen({ type: "done" });
    await promise;
    expect(toolCalls).toEqual([["closeTab", "not-json"]]);
  });

  it("rejects on an error chunk", async () => {
    const promise = streamChat({ messages: [], model: "m" });
    listenerOf(portAt(0))({ type: "error", message: "Ollama 400" });
    await expect(promise).rejects.toThrow("Ollama 400");
  });

  it("retries without tools when the failure names tool support", async () => {
    const onRetry = vi.fn();
    const promise = streamChat({
      messages: [],
      model: "m",
      tools: [{}],
      onRetry,
    });
    listenerOf(portAt(0))({
      type: "error",
      message: "Ollama 400: model does not support tools",
    });
    await vi.waitFor(() =>
      expect(chrome().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const port2 = portAt(1);
    listenerOf(port2)({ type: "done" });
    await promise;
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(requestBody(port2).tools).toBeUndefined();
  });

  it("does not retry on a plain failure (Ollama down)", async () => {
    const onRetry = vi.fn();
    const promise = streamChat({
      messages: [],
      model: "m",
      tools: [{}],
      onRetry,
    });
    listenerOf(portAt(0))({ type: "error", message: "fetch failed" });
    await expect(promise).rejects.toThrow("fetch failed");
    expect(onRetry).not.toHaveBeenCalled();
    expect(chrome().runtime.connect).toHaveBeenCalledTimes(1);
  });

  it("does not retry on a missing-model 404", async () => {
    const promise = streamChat({ messages: [], model: "m", tools: [{}] });
    listenerOf(portAt(0))({ type: "error", message: "Ollama 404" });
    await expect(promise).rejects.toThrow("Ollama 404");
    expect(chrome().runtime.connect).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the user aborted", async () => {
    const ctrl = new AbortController();
    const onRetry = vi.fn();
    const promise = streamChat({
      messages: [],
      model: "m",
      tools: [{}],
      signal: ctrl.signal,
      onRetry,
    });
    const port = portAt(0);
    ctrl.abort();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "abort" });
    listenerOf(port)({ type: "error", message: "aborted" });
    await expect(promise).rejects.toThrow("aborted");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("rejects when chrome.runtime.connect is unavailable", async () => {
    const runtime = chrome().runtime as { connect?: unknown };
    delete runtime.connect;
    await expect(streamChat({ messages: [], model: "m" })).rejects.toThrow(
      "chrome.runtime.connect unavailable",
    );
  });
});

describe("streamOllamaFetch", () => {
  function streamBody(chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
  }

  it("forwards NDJSON lines (incl. split across chunks), done, then disconnects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: streamBody([
          '{"message":{"content":"a"}}\n{"mes',
          'sage":{"content":"b"}}\n',
        ]),
      })),
    );
    const port = makeFakePort();
    await streamOllamaFetch(port, "/api/chat", { method: "POST", body: "{}" });
    expect(port.postMessage.mock.calls.map((c) => c[0])).toEqual([
      { type: "chunk", data: '{"message":{"content":"a"}}' },
      { type: "chunk", data: '{"message":{"content":"b"}}' },
      { type: "done" },
    ]);
    expect(port.disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("posts an error on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, body: null })),
    );
    const port = makeFakePort();
    await streamOllamaFetch(port, "/api/chat", {});
    expect(port.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "Ollama 400",
    });
    vi.unstubAllGlobals();
  });

  it("aborts the fetch when the client posts an abort message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const port = makeFakePort();
    const done = streamOllamaFetch(port, "/api/chat", {});
    const listen = port._onMessage.mock.calls[0][0] as (msg: unknown) => void;
    listen({ type: "abort" });
    await done;
    expect(port.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "aborted",
    });
    vi.unstubAllGlobals();
  });
});
