import type { EnrichedTab } from "../../types/index";

/**
 * Ask AI sidebar — tool calling.
 *
 * "AI proposes, the UI executes": the model may emit a `closeTab` tool call,
 * but the UI validates every call against the live tab store before any tab
 * is closed. Pinned tabs are NEVER closable from chat (same rule as
 * `useTabActions.saveAndClose`).
 *
 * The model identifies tabs by their EXACT title (names, not numeric ids —
 * ids are meaningless to a person reading the transcript). A title match is
 * case-insensitive after trimming; when several open tabs share a title
 * (duplicate Gmail/Inbox tabs), they are all closed — the user clearly means
 * those tabs. The schema mirrors Ollama's `/api/chat` tool format.
 */

export const CLOSE_TAB_TOOL = {
  type: "function",
  function: {
    name: "closeTab",
    description:
      "Close one or more open browser tabs by their exact title (from the open tabs list). " +
      "Never close a pinned tab. Closes every open tab with that title.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab(s) to close.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export type CloseTarget =
  | { tabs: EnrichedTab[]; skippedPinned: number }
  | { error: "missing-title" | "no-match" };

function normalize(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Validate a model-produced closeTab call against the live tab list.
 * `args` is whatever the model produced (already JSON-parsed object, or a
 * raw string when parsing failed). Only exact title matches pass; matches
 * on pinned tabs are reported (skippedPinned) but never closed.
 */
export function resolveCloseTarget(args: unknown, tabs: EnrichedTab[]): CloseTarget {
  const obj = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;
  const title = obj?.title;
  if (typeof title !== "string" || title.trim() === "") return { error: "missing-title" };
  const wanted = normalize(title);
  const matches = tabs.filter((t) => normalize(t.title) === wanted);
  if (matches.length === 0) return { error: "no-match" };
  return {
    tabs: matches.filter((t) => !t.isPinned),
    skippedPinned: matches.filter((t) => t.isPinned).length,
  };
}

/** Human summary of a close-tab result, for the tool card in the thread. */
export function closeResultText(result: CloseTarget, name: string): string {
  if ("error" in result) {
    switch (result.error) {
      case "missing-title":
        return `${name}: no title given — nothing closed`;
      case "no-match":
        return `${name}: no open tab with that title — nothing closed`;
    }
  }
  const closed = result.tabs.map((t) => `closed — ${t.title}`).join(" · ");
  const pinnedNote =
    result.skippedPinned > 0 ? ` · ${result.skippedPinned} pinned tab(s) not closed` : "";
  return `${name}: ${closed || "nothing closed"}${pinnedNote}`;
}

// ─── text-claim fallback (weak models that narrate instead of calling) ───────

/**
 * Small models (mistral) sometimes reply "Close the 'Outlook ...' tab." in
 * prose without emitting a real tool call. The UI renders those claims as
 * actionable chips ("Close · Outlook") — the user clicks, the UI validates
 * and executes. Never auto-closes from text.
 */

export interface CloseProposal {
  /** The resolved exact title (already validated against live tabs). */
  title: string;
  tabIds: number[];
}

/** Extract quoted or plain "close/closing/closed ... tab" mentions. */
export function extractCloseTitles(text: string): string[] {
  const out: string[] = [];
  const quoted =
    /["'`]([^"'`\n]{2,80})["'`]\s+tab\b/gi;
  for (const m of text.matchAll(quoted)) out.push(m[1]);
  const plain = /\b(?:close|closing|closed|closes)\b\s+(?:the\s+)?([^"'`\n.!?]{2,80}?)\s+tab\b/gi;
  for (const m of text.matchAll(plain)) out.push(m[1].trim());
  return out;
}

function titleCandidates(raw: string): string[] {
  const exact = raw.trim();
  const stripped = exact.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped === exact ? [exact] : [exact, stripped];
}

/**
 * Resolve every close-claim in the assistant's text against the live tab
 * list. Exact titles win; a trailing "(domain)" suffix is tried as a second
 * candidate (models echo the list format "Title (domain)"). Pinned tabs are
 * never proposed. Returns [] when nothing resolves — the UI shows no chip.
 */
export function detectCloseProposals(text: string, tabs: EnrichedTab[]): CloseProposal[] {
  const seen = new Set<string>();
  const out: CloseProposal[] = [];
  for (const raw of extractCloseTitles(text)) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    for (const candidate of titleCandidates(raw)) {
      const target = resolveCloseTarget({ title: candidate }, tabs);
      if ("tabs" in target && target.tabs.length > 0) {
        out.push({ title: candidate, tabIds: target.tabs.map((t) => t.id) });
        break;
      }
    }
  }
  return out;
}