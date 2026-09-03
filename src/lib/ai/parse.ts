/**
 * Strict JSON extraction with graceful fallbacks.
 *
 * Ollama with `format: "json"` usually returns clean JSON, but prose can
 * still sneak in around it (code fences, "Here is the result:"). Every parser
 * here tries strict `JSON.parse` first, then progressively looser extraction
 * (fenced blocks, first balanced `{…}`/`[…]`), then the raw fallback used by
 * `parseRelevantIds` — so downstream features never trust raw output.
 */

/** Best-effort parse of any embedded JSON value. Returns null on garbage. */
export function extractJson(text: string): unknown {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const unfenced = tryParse(fenced);
  if (unfenced !== undefined) return unfenced;

  // Walk candidate blocks left-to-right: an earlier `[1]` before the real
  // `{…}` must not shadow it.
  for (const block of balancedBlocks(fenced)) {
    const parsed = tryParse(block);
    if (parsed !== undefined) return parsed;
  }
  return null;
}

/** Extract the object under a top-level key, e.g. `{"summary": …}`. */
export function extractField(
  text: string,
  key: string,
): unknown {
  const root = extractJson(text);
  if (root && typeof root === "object" && !Array.isArray(root)) {
    return (root as Record<string, unknown>)[key];
  }
  // Loose fallback for inline `"summary": "…"` / `summary: "…"` inside
  // otherwise-unparseable prose (e.g. output truncated mid-object).
  const m = new RegExp(`(?:"${key}"|${key})\\s*[:=]\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(\\[[^\\]]*\\]|\\{[^}]*\\}|\\d+))`, "i").exec(text);
  if (m) {
    if (m[1] !== undefined) return m[1].replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "$1");
    // Non-string capture: must actually parse (handles "42", rejects a
    // truncated "[1,[2]" which would otherwise surface as a raw string).
    return tryParse(m[2] ?? "") ?? null;
  }
  return undefined;
}

/** Parse a JSON array (with `id`-aware fallback: grab all numbers in order). */
export function parseNumericIds(text: string, validIds: number[]): number[] {
  const valid = new Set(validIds);
  const root = extractJson(text);
  const arr: unknown = Array.isArray(root)
    ? root
    : root && typeof root === "object"
      ? (root as Record<string, unknown>).ids
      : undefined;
  if (Array.isArray(arr)) {
    const ids = arr.map(coerceNumber).filter((n): n is number => n !== null);
    return Array.from(new Set(ids)).filter((n) => valid.has(n));
  }
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  return Array.from(new Set(nums)).filter((n) => valid.has(n));
}

/**
 * Parse an array of items by mapping each element through `parseItem`; items
 * that fail the validator are skipped, never thrown.
 */
export function parseList<T>(
  text: string,
  parseItem: (raw: unknown) => T | null,
): T[] {
  const root = extractJson(text);
  let arr: unknown = Array.isArray(root) ? root : undefined;
  if (!arr && root && typeof root === "object") {
    const items = (root as Record<string, unknown>).items;
    if (Array.isArray(items)) arr = items;
  }
  if (!Array.isArray(arr)) return [];
  const out: T[] = [];
  for (const raw of arr) {
    const item = parseItem(raw);
    if (item !== null) out.push(item);
  }
  return out;
}

// ─── primitive coercers ─────────────────────────────────────────────────────

export function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null; // Number("") is 0 — a bogus id
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function coerceString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

export function coerceStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = coerceString(item);
    if (s !== null) out.push(s);
  }
  return out;
}

// ─── internals ──────────────────────────────────────────────────────────────

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The balanced `{…}` / `[…]` block starting exactly at `start`, or null. */
function firstBalancedBlockFrom(text: string, start: number): string | null {
  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Every balanced `{…}` / `[…]` block in the text, left to right, deduped.
 * Unclosed openers (prose with a stray brace) are skipped, so a later valid
 * block is still found.
 */
function balancedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const block = firstBalancedBlockFrom(text, i);
    if (block === null) continue;
    if (!seen.has(block)) {
      seen.add(block);
      blocks.push(block);
    }
  }
  return blocks;
}