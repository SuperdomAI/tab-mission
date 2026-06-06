import type { EnrichedTab } from "../types/index";

export const OLLAMA_BASE = "http://localhost:11434";
// Chrome match patterns must NOT include a port — request host-wide access.
// (The CSP connect-src, which is separate, keeps the explicit :11434 entries.)
const ORIGINS = ["http://localhost/*", "http://127.0.0.1/*"];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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
 * Falls back to a direct fetch in non-extension contexts (tests).
 */
async function bgFetch(path: string, init?: BgInit): Promise<BgResult> {
  const rt = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (rt?.sendMessage) {
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
