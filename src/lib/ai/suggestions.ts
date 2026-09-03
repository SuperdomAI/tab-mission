/**
 * F3 proactive workspace suggestions — backed by the `aiSuggestions` key in
 * `chrome.storage.local`, written ONLY by the React layer (UI-owned, same
 * precedent as `aiReports` / `aiIdleDraftDismissedAt`).
 *
 * Storage shape is a single suggestions object (the latest generation wins):
 *
 *   { signature, items: [{ goal, tabIds, reason }],
 *     generatedAt, model, tabCount, dismissed }
 *
 * `signature` is the `tabSetSignature` of the open tab set that produced the
 * plan; `tabCount` is the number of open tabs at generation time. The Stacks
 * strip reuses the cached plan while the tab set is unchanged OR has churned
 * by fewer than `SUGGESTION_REGEN_THRESHOLD` tabs (small changes don't
 * invalidate a still-useful plan), and regenerates when the set changed by
 * ≥ 5 tabs. `dismissed` is the per-plan "hide for this session" flag: the
 * user dismisses the strip, and a NEW generation (tab set changed ≥ 5) resets
 * it — so the strip stays quiet until genuinely new suggestions exist.
 * Freshness is the `suggestions` task TTL (30 min) + model-mismatch rejection,
 * mirroring `AiCache`.
 */

import { TASK_TTL_MS } from "./cache";
import { buildSuggestionsPrompt, TRIAGE_TAB_CAP, type SuggestTab } from "./prompts";
import { extractJson, coerceNumber, coerceString } from "./parse";
import { generate } from "../ollama";

export const AI_SUGGESTIONS_KEY = "aiSuggestions";

/** Regenerate when the open tab set changed by at least this many tabs. */
export const SUGGESTION_REGEN_THRESHOLD = 5;

/** The `suggestions` task TTL (30 min) — fast-model output goes stale quickly. */
export const SUGGESTIONS_TTL_MS = TASK_TTL_MS.suggestions;

export interface Suggestion {
  goal: string;
  tabIds: number[];
  reason: string;
}

export interface Suggestions {
  /** `tabSetSignature` of the open tab set that produced this plan. */
  signature: string;
  items: Suggestion[];
  generatedAt: number;
  model: string;
  /** Open-tab count at generation time (drives the ≥ 5-tab regen rule). */
  tabCount: number;
  /** UI-owned: dismiss hides the strip until the next generation. */
  dismissed: boolean;
}

// ─── parser (single funnel: extractJson → shape validation) ─────────────────

/** Shape-validate one raw suggestion (no id filtering — shared by parse + coerce). */
function coerceSuggestion(raw: unknown): Suggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const goal = coerceString(r.goal);
  const reason = coerceString(r.reason);
  if (!goal || !reason) return null;
  if (!Array.isArray(r.tabIds)) return null;
  const tabIds: number[] = [];
  for (const id of r.tabIds) {
    const n = coerceNumber(id);
    if (n !== null && n > 0 && !tabIds.includes(n)) tabIds.push(n);
  }
  if (tabIds.length === 0) return null;
  return { goal, tabIds, reason };
}

/**
 * Parse model output into suggestions. The prompt contract caps the list at
 * 2; anything beyond that is dropped. Suggestions with an empty goal/reason,
 * no tab ids, or ids outside `validIds` are skipped; the plan is null when
 * nothing survives validation.
 */
export function parseSuggestions(text: string, validIds: number[]): Suggestion[] | null {
  const root = extractJson(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const rawItems = (root as Record<string, unknown>).suggestions;
  if (!Array.isArray(rawItems)) return null;
  const valid = new Set(validIds);
  const items: Suggestion[] = [];
  for (const raw of rawItems) {
    if (items.length >= 2) break; // the prompt's cap
    const s = coerceSuggestion(raw);
    if (!s) continue;
    const filtered = s.tabIds.filter((id) => valid.has(id));
    if (filtered.length === 0) continue;
    items.push({ ...s, tabIds: filtered });
  }
  return items.length > 0 ? items : null;
}

// ─── storage coercion + freshness (single object, not a map) ─────────────────

/**
 * Coerce whatever is on disk into a valid suggestions object, or null.
 * Malformed envelopes/items are dropped rather than trusted (never trust
 * disk — the same rule the service worker's triage coercion follows).
 */
export function coerceSuggestions(raw: unknown): Suggestions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.signature !== "string" ||
    typeof r.generatedAt !== "number" ||
    typeof r.model !== "string" ||
    typeof r.tabCount !== "number"
  ) {
    return null;
  }
  const items: Suggestion[] = [];
  const rawItems = r.items;
  if (!Array.isArray(rawItems)) return null;
  for (const rawItem of rawItems) {
    const s = coerceSuggestion(rawItem);
    if (s) items.push(s);
  }
  if (items.length === 0) return null;
  return {
    signature: r.signature,
    items,
    generatedAt: r.generatedAt,
    model: r.model,
    tabCount: r.tabCount,
    dismissed: r.dismissed === true,
  };
}

/** Freshness wrapper over the single stored suggestions object. */
export class SuggestionsCache {
  private constructor(private plan: Suggestions | null) {}

  static empty(): SuggestionsCache {
    return new SuggestionsCache(null);
  }

  static fromStorage(raw: unknown): SuggestionsCache {
    return new SuggestionsCache(coerceSuggestions(raw));
  }

  /**
   * The plan to show for this tab set, or undefined when it should be
   * regenerated: missing, past the 30-min TTL, produced by a different model,
   * or the tab set changed by ≥ `SUGGESTION_REGEN_THRESHOLD` tabs. Small
   * churn (< 5 tabs) keeps the cached plan — the suggestions are still valid
   * guidance and the strip must not flicker.
   */
  get(
    signature: string,
    model: string,
    tabCount: number,
    now: number = Date.now(),
  ): Suggestions | undefined {
    if (!this.plan) return undefined;
    if (this.plan.model !== model || now - this.plan.generatedAt > SUGGESTIONS_TTL_MS) {
      return undefined;
    }
    if (this.plan.signature === signature) return this.plan;
    if (Math.abs(tabCount - this.plan.tabCount) < SUGGESTION_REGEN_THRESHOLD) {
      return this.plan;
    }
    return undefined;
  }

  set(plan: Suggestions): SuggestionsCache {
    return new SuggestionsCache(plan);
  }

  clear(): SuggestionsCache {
    return new SuggestionsCache(null);
  }

  toJSON(): Suggestions | null {
    return this.plan;
  }
}

// ─── generation (thin wrapper over the fast-tier transport) ─────────────────

/**
 * Generate suggestions for the open tab set; throws when the model output is
 * unparseable. The prompt lists at most `TRIAGE_TAB_CAP` tabs, so validation
 * is scoped to the same set.
 */
export async function generateSuggestions(
  tabs: SuggestTab[],
  model: string,
): Promise<Suggestion[]> {
  const capped = tabs.slice(0, TRIAGE_TAB_CAP);
  const text = await generate(buildSuggestionsPrompt(tabs), model, "fast");
  const items = parseSuggestions(text, capped.map((t) => t.id));
  if (!items) throw new Error("Suggestions output did not match the expected shape");
  return items;
}