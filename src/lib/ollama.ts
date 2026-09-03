import type { EnrichedTab } from "../types/index";
import { NUM_CTX, type TextTask } from "./ai/models";

export const OLLAMA_BASE = "http://localhost:11434";
// Chrome match patterns must NOT include a port — request host-wide access.
// (The CSP connect-src, which is separate, keeps the explicit :11434 entries.)
const ORIGINS = ["http://localhost/*", "http://127.0.0.1/*"];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Assistant message carrying tool calls (Ollama /api/chat tools support). */
export interface ToolCall {
  name: string;
  arguments: string;
}
export interface AssistantToolMessage {
  role: "assistant";
  content: string;
  tool_calls?: ToolCall[];
}
export interface ToolResultMessage {
  role: "tool";
  content: string;
}
export type ChatMessageFull =
  | ChatMessage
  | AssistantToolMessage
  | ToolResultMessage;

type TabLite = Pick<EnrichedTab, "id" | "title" | "domain">;

interface BgInit {
  method?: string;
  body?: string;
}
interface BgResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * Route Ollama calls through the background service worker. A fetch from the
 * extension PAGE sends `Origin: chrome-extension://…`, which Ollama's CORS gate
 * rejects with 403. A fetch from the background carries no web origin, so the
 * gate passes — the standard pattern for extensions talking to a local server.
 * Falls back to a direct fetch in non-extension contexts (tests) and in the
 * service worker itself (no `window`): the SW is where the proxy listener
 * lives, so proxying through it would be a pointless (and unresolvable)
 * round-trip. Exported so the service worker and AI layer can reuse the same
 * transport.
 */
export async function bgFetch(path: string, init?: BgInit): Promise<BgResult> {
  const rt = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (rt?.sendMessage && typeof window !== "undefined") {
    return (await rt.sendMessage({ type: "ollama-fetch", path, init })) as BgResult;
  }
  const r = await fetch(`${OLLAMA_BASE}${path}`, {
    method: init?.method,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body,
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

/** Request the optional localhost host permission (only when the user opts in). */
export async function ensureOllamaPermission(): Promise<boolean> {
  try {
    const perms = (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
    if (!perms) return true; // non-extension context (tests)
    if (await perms.contains({ origins: ORIGINS })) return true;
    return await perms.request({ origins: ORIGINS });
  } catch {
    return false;
  }
}

/** True if a local Ollama server answers. Never throws. */
export async function detectOllama(): Promise<boolean> {
  try {
    return (await bgFetch("/api/tags")).ok;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await bgFetch("/api/tags");
    if (!res.ok) return [];
    const data = JSON.parse(res.body) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

// ─── pure helpers (tested) ──────────────────────────────────────────────────

export function buildClassifyPrompt(goal: string, tabs: TabLite[]): string {
  const list = tabs.map((t) => `${t.id}: ${t.title} (${t.domain})`).join("\n");
  return [
    "You help a user focus by picking which open browser tabs are relevant to a goal.",
    `Goal: "${goal}"`,
    "Tabs (id: title (domain)):",
    list,
    "",
    'Reply with ONLY JSON: {"keep":[<ids relevant to the goal>]}. No prose.',
  ].join("\n");
}

export function parseRelevantIds(text: string, validIds: number[]): number[] {
  const valid = new Set(validIds);
  try {
    const obj = JSON.parse(text);
    const arr: unknown = Array.isArray(obj)
      ? obj
      : (obj?.keep ?? obj?.relevant ?? []);
    if (Array.isArray(arr)) {
      return arr.map(Number).filter((n) => valid.has(n));
    }
  } catch {
    /* fall through to number extraction */
  }
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  return Array.from(new Set(nums)).filter((n) => valid.has(n));
}

// ─── network calls (via background) ─────────────────────────────────────────

/** Ask the model which tab ids are relevant. Returns the KEEP id list. */
export async function classifyRelevant(
  goal: string,
  tabs: TabLite[],
  model: string,
): Promise<number[]> {
  const res = await bgFetch("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      model,
      prompt: buildClassifyPrompt(goal, tabs),
      stream: false,
      format: "json",
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = JSON.parse(res.body) as { response?: string };
  return parseRelevantIds(String(data.response ?? ""), tabs.map((t) => t.id));
}

export async function chat(messages: ChatMessage[], model: string): Promise<string> {
  const res = await bgFetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = JSON.parse(res.body) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

/**
 * JSON-mode completion via `/api/generate`, with the tier's suggested context
 * window (`num_ctx` 4096 fast / 8192 chat per `docs/AI-FEATURES-PLAN.md` §2).
 * The AI layer always pairs this with `parse.ts` fallbacks — never trust the
 * raw output.
 */
export async function generate(
  prompt: string,
  model: string,
  ctx: TextTask = "chat",
): Promise<string> {
  const res = await bgFetch("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
      options: { num_ctx: NUM_CTX[ctx] },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = JSON.parse(res.body) as { response?: string };
  return String(data.response ?? "");
}

/** Embed a batch of texts via `/api/embed`. Returns one vector per input. */
export async function embed(texts: string[], model: string): Promise<number[][]> {
  const res = await bgFetch("/api/embed", {
    method: "POST",
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = JSON.parse(res.body) as { embeddings?: number[][] };
  return data.embeddings ?? [];
}

// ─── streaming chat (Ask AI sidebar) ─────────────────────────────────────────
// The page opens a `chrome.runtime` port named "ollama-stream"; the service
// worker's `onConnect` handler (service-worker.ts) proxies `/api/chat` with
// `stream: true` and forwards the NDJSON response line-by-line. `streamChat`
// parses deltas into text + tool calls; `streamOllamaFetch` is the SW-side
// loop (exported so it is unit-testable with a fake port).

interface StreamPort {
  postMessage: (msg: unknown) => void;
  onMessage?: { addListener: (fn: (msg: unknown) => void) => void };
  onDisconnect?: { addListener: (fn: () => void) => void };
  disconnect?: () => void;
}

export interface StreamChatOptions {
  messages: ChatMessageFull[];
  model: string;
  /** Ollama tool definitions (undefined = no tools). */
  tools?: unknown[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
  /** Fired when the request is retried without tools (model/Ollama lacks them). */
  onRetry?: () => void;
}

interface ChatStreamDelta {
  message?: {
    content?: string;
    tool_calls?: { function?: { name?: string; arguments?: string } }[];
  };
  error?: string;
}

function parseStreamLine(
  line: string,
  opts: StreamChatOptions,
  onError: (message: string) => void,
): void {
  let delta: ChatStreamDelta;
  try {
    delta = JSON.parse(line) as ChatStreamDelta;
  } catch {
    return; // malformed keep-alive — ignore
  }
  if (delta.error) {
    onError(delta.error);
    return;
  }
  const content = delta.message?.content;
  if (content) opts.onDelta?.(content);
  const calls = delta.message?.tool_calls ?? [];
  for (const call of calls) {
    const name = call.function?.name;
    if (!name) continue;
    const raw = call.function?.arguments ?? "{}";
    let args: unknown = raw;
    try {
      args = JSON.parse(raw);
    } catch {
      args = raw; // unparseable arguments — the validator rejects them
    }
    opts.onToolCall?.(name, args);
  }
}

/**
 * Stream one chat turn over the SW proxy port. Resolves when the model
 * finishes; rejects on error/abort/disconnect. When `tools` were passed and
 * the request fails (Ollama/model without tool support → 400), retries once
 * WITHOUT tools and fires `onRetry` so the UI can say the tool bar is off.
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const rt = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!rt?.connect) throw new Error("chrome.runtime.connect unavailable");

  const run = (tools?: unknown[]): Promise<void> =>
    new Promise((resolve, reject) => {
      const port = rt.connect({ name: "ollama-stream" });
      let settled = false;
      const cleanup = () => {
        if (opts.signal) opts.signal.removeEventListener("abort", abort);
        port.disconnect?.();
      };
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const fail = (message: string) => {
        if (!settled) finish(() => reject(new Error(message)));
      };
      port.onMessage?.addListener((msg) => {
        const m = msg as { type?: string; data?: string; message?: string };
        if (m?.type === "chunk" && m.data) {
          parseStreamLine(m.data, opts, fail);
        } else if (m?.type === "done") {
          finish(resolve);
        } else if (m?.type === "error") {
          fail(m.message ?? "stream error");
        }
      });
      port.onDisconnect?.addListener(() => fail("stream disconnected"));
      const abort = () => port.postMessage({ type: "abort" });
      opts.signal?.addEventListener("abort", abort, { once: true });
      port.postMessage({
        type: "stream-request",
        path: "/api/chat",
        init: {
          method: "POST",
          body: JSON.stringify({
            model: opts.model,
            messages: opts.messages,
            stream: true,
            tools: tools?.length ? tools : undefined,
            // Qwen3 defaults to thinking mode — a no-op for other models, but
            // for chat-tier agents it's pure latency (reasoning tokens we
            // don't render). Keep the tab chat snappy.
            think: false,
            options: { num_ctx: NUM_CTX.chat },
          }),
        },
      });
    });

  try {
    await run(opts.tools);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const aborting = opts.signal?.aborted || /abort/i.test(message);
    // Retry WITHOUT tools only when the failure actually says the model/Ollama
    // lacks tool support — "fetch failed" (Ollama down) and 404 (model missing)
    // must surface immediately with their real hints.
    if (opts.tools?.length && !aborting && /tools/i.test(message)) {
      opts.onRetry?.();
      await run(undefined);
      return;
    }
    throw e;
  }
}

/**
 * Service-worker side of the stream: fetch Ollama with `stream: true` and
 * forward each NDJSON line to the port. Aborts the fetch when the client
 * posts `{ type: "abort" }` or disconnects.
 */
export async function streamOllamaFetch(
  port: StreamPort,
  path: string,
  init?: { method?: string; body?: string },
): Promise<void> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  port.onMessage?.addListener((msg) => {
    if ((msg as { type?: string })?.type === "abort") abort();
  });
  port.onDisconnect?.addListener(abort);
  try {
    const r = await fetch(`${OLLAMA_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body,
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) {
      port.postMessage({ type: "error", message: `Ollama ${r.status}` });
      return;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) port.postMessage({ type: "chunk", data: line });
      }
    }
    port.postMessage({ type: "done" });
  } catch (e) {
    const message = ctrl.signal.aborted ? "aborted" : String(e);
    port.postMessage({ type: "error", message });
  } finally {
    port.disconnect?.();
  }
}
