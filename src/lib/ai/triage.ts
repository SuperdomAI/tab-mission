/**
 * F2 tab-debt triage + F12 idle drafts — backed by the `aiTriagePlan` key in
 * `chrome.storage.local`, written by BOTH the React layer (on-demand, source
 * "on-demand") and the service worker (idle drafts, source "idle").
 *
 * Storage shape is a single plan object (not a map — the latest plan wins):
 *
 *   { signature, items: [{ tabId, reason, action, category }],
 *     generatedAt, source: "on-demand" | "idle", model }
 *
 * `signature` is the `tabSetSignature` of the candidate list that produced the
 * plan, so a plan is only reused while the candidate set is unchanged. TTL is
 * per source: 1 h for on-demand (the `triage` task), 2 h for idle drafts so a
 * "while you were away" notice survives a short idle. Everything here is pure
 * (candidate selection, parsing, storage coercion) or a thin wrapper over the
 * fast-tier transport; the React layer and the service worker share it.
 */

import { HOUR, TASK_TTL_MS } from "./cache";
import { buildTriagePrompt, TRIAGE_TAB_CAP, type TriageTab } from "./prompts";
import { extractJson, coerceNumber, coerceString } from "./parse";
import { tabSetSignature } from "./signatures";
import { generate } from "../ollama";
import { clearableForgotten } from "../bucketByRecency";
import { selectZombies, selectUnvisited } from "../bulkSelectors";
import type { AppSettings, EnrichedTab } from "../../types/index";

export const AI_TRIAGE_KEY = "aiTriagePlan";
/** UI-owned notice flag: when an idle draft was last dismissed ("Review" ×). */
export const IDLE_DISMISS_KEY = "aiIdleDraftDismissedAt";

export type TriageSource = "on-demand" | "idle";
export type TriageAction = "close" | "keep";
export type TriageCategory =
  | "duplicate"
  | "same-thread"
  | "stale"
  | "unvisited"
  | "junk";

export interface TriageItem {
  tabId: number;
  reason: string;
  action: TriageAction;
  category: TriageCategory;
}

export interface TriagePlan {
  /** `tabSetSignature` of the candidate list that produced this plan. */
  signature: string;
  items: TriageItem[];
  generatedAt: number;
  source: TriageSource;
  model: string;
}

/** TTL per source: on-demand matches the `triage` task; idle drafts last 2 h. */
export const TRIAGE_TTL_MS: Record<TriageSource, number> = {
  "on-demand": TASK_TTL_MS.triage,
  idle: 2 * HOUR,
};

const ACTIONS: TriageAction[] = ["close", "keep"];
const CATEGORIES: TriageCategory[] = [
  "duplicate",
  "same-thread",
  "stale",
  "unvisited",
  "junk",
];

// ─── candidate selection (the F2 input) ─────────────────────────────────────

/**
 * Tabs worth asking the model about: everything "Clear forgotten" may close,
 * plus zombies and never-visited tabs. Deduped (a forgotten zombie is one
 * candidate), pinned excluded (the selectors already guarantee that), and
 * capped at `TRIAGE_TAB_CAP` — forgotten tabs first (most tab debt), then
 * zombies, then unvisited.
 */
export function triageCandidates(
  tabs: EnrichedTab[],
  settings: AppSettings,
  now: number = Date.now(),
): EnrichedTab[] {
  const seen = new Set<number>();
  const out: EnrichedTab[] = [];
  for (const tab of [
    ...clearableForgotten(tabs, now),
    ...selectZombies(tabs, settings, now),
    ...selectUnvisited(tabs, now),
  ]) {
    if (seen.has(tab.id)) continue;
    seen.add(tab.id);
    out.push(tab);
    if (out.length >= TRIAGE_TAB_CAP) break;
  }
  return out;
}

// ─── parser (single funnel: extractJson → shape validation) ─────────────────

/** Shape-validate raw items (no id filtering — used by storage coercion too). */
function coerceItems(raw: unknown): TriageItem[] {
  if (!Array.isArray(raw)) return [];
  const items: TriageItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const tabId = coerceNumber(r.tabId);
    const reason = coerceString(r.reason);
    const action = coerceString(r.action);
    const category = coerceString(r.category);
    if (tabId === null || !reason) continue;
    if (!action || !ACTIONS.includes(action as TriageAction)) continue;
    if (!category || !CATEGORIES.includes(category as TriageCategory)) continue;
    items.push({
      tabId,
      reason,
      action: action as TriageAction,
      category: category as TriageCategory,
    });
  }
  return items;
}

/**
 * Parse model output into triage items. Items with an unknown action/category,
 * an empty reason, or a tabId outside `validIds` are skipped; the plan is
 * null when nothing survives validation.
 */
export function parseTriagePlan(text: string, validIds: number[]): TriageItem[] | null {
  const root = extractJson(text);
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const items = coerceItems((root as Record<string, unknown>).items);
  if (items.length === 0) return null;
  const valid = new Set(validIds);
  const filtered = items.filter((i) => valid.has(i.tabId));
  return filtered.length > 0 ? filtered : null;
}

// ─── storage coercion + freshness (single plan, not a map) ──────────────────

/**
 * Coerce whatever is on disk into a valid plan, or null. Shared by the UI
 * hook and the service worker's signature check; malformed rows are dropped
 * rather than trusted.
 */
export function coerceTriagePlan(raw: unknown): TriagePlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.signature !== "string" ||
    typeof r.generatedAt !== "number" ||
    typeof r.model !== "string" ||
    (r.source !== "on-demand" && r.source !== "idle")
  ) {
    return null;
  }
  const items = coerceItems(r.items);
  if (items.length === 0) return null;
  return {
    signature: r.signature,
    items,
    generatedAt: r.generatedAt,
    source: r.source,
    model: r.model,
  };
}

/** Freshness wrapper over the single stored plan (mirrors `AiCache`). */
export class TriageCache {
  private constructor(private plan: TriagePlan | null) {}

  static empty(): TriageCache {
    return new TriageCache(null);
  }

  static fromStorage(raw: unknown): TriageCache {
    return new TriageCache(coerceTriagePlan(raw));
  }

  /**
   * Fresh plan for this signature + model, or undefined when missing, stale
   * for its source's TTL, or produced by a different model.
   */
  get(
    signature: string,
    model: string,
    now: number = Date.now(),
  ): TriagePlan | undefined {
    if (!this.plan) return undefined;
    if (this.plan.signature !== signature || this.plan.model !== model) {
      return undefined;
    }
    if (now - this.plan.generatedAt > TRIAGE_TTL_MS[this.plan.source]) {
      return undefined;
    }
    return this.plan;
  }

  /**
   * The latest fresh idle-sourced draft, signature/model-agnostic — the input
   * for the Timeline notice chip ("AI drafted a cleanup plan while you were
   * away"). Reviewing it re-validates against the current tab set.
   */
  idlePlan(now: number = Date.now()): TriagePlan | undefined {
    if (!this.plan || this.plan.source !== "idle") return undefined;
    if (now - this.plan.generatedAt > TRIAGE_TTL_MS.idle) return undefined;
    return this.plan;
  }

  set(plan: TriagePlan): TriageCache {
    return new TriageCache(plan);
  }

  clear(): TriageCache {
    return new TriageCache(null);
  }

  toJSON(): TriagePlan | null {
    return this.plan;
  }
}

// ─── generation (thin wrapper over the fast-tier transport) ─────────────────

/** Generate a triage plan for the candidates; throws when unparseable. */
export async function generateTriage(
  tabs: TriageTab[],
  model: string,
): Promise<TriageItem[]> {
  const text = await generate(buildTriagePrompt(tabs), model, "fast");
  const items = parseTriagePlan(text, tabs.map((t) => t.id));
  if (!items) throw new Error("Triage output did not match the expected shape");
  return items;
}