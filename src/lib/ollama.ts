import type { EnrichedTab } from "../types/index";

export const OLLAMA_BASE = "http://localhost:11434";
const ORIGIN = "http://localhost:11434/*";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type TabLite = Pick<EnrichedTab, "id" | "title" | "domain">;

/** Request the optional localhost host permission (only when the user opts in). */
export async function ensureOllamaPermission(): Promise<boolean> {
  try {
    const perms = (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
    if (!perms) return true; // non-extension context (tests)
    if (await perms.contains({ origins: [ORIGIN] })) return true;
    return await perms.request({ origins: [ORIGIN] });
  } catch {
    return false;
  }
}

/** True if a local Ollama server answers. Never throws. */
export async function detectOllama(base = OLLAMA_BASE): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/tags`);
    return r.ok;
  } catch {
    return false;
  }
}

export async function listModels(base = OLLAMA_BASE): Promise<string[]> {
  try {
    const r = await fetch(`${base}/api/tags`);
    if (!r.ok) return [];
    const data = (await r.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

// ─── pure helpers (tested) ──────────────────────────────────────────────────

export function buildClassifyPrompt(goal: string, tabs: TabLite[]): string {
  const list = tabs
    .map((t) => `${t.id}: ${t.title} (${t.domain})`)
    .join("\n");
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

// ─── network calls ──────────────────────────────────────────────────────────

/** Ask the model which tab ids are relevant. Returns the KEEP id list. */
export async function classifyRelevant(
  goal: string,
  tabs: TabLite[],
  model: string,
  base = OLLAMA_BASE,
): Promise<number[]> {
  const r = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: buildClassifyPrompt(goal, tabs),
      stream: false,
      format: "json",
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}`);
  const data = (await r.json()) as { response?: string };
  return parseRelevantIds(String(data.response ?? ""), tabs.map((t) => t.id));
}

export async function chat(
  messages: ChatMessage[],
  model: string,
  base = OLLAMA_BASE,
): Promise<string> {
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}`);
  const data = (await r.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
