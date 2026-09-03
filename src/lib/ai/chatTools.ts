import type { EnrichedTab } from "../../types/index";
import { truncatePageText } from "../pageExtract";

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

export const HIBERNATE_TAB_TOOL = {
  type: "function",
  function: {
    name: "hibernateTab",
    description:
      "Hibernate (discard/unload) one or more open browser tabs by their exact title to free memory. " +
      "The tab stays open — it just unloads and reloads on next visit. This is NOT closing. " +
      "Never hibernate a pinned tab. Hibernates every open tab with that title.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab(s) to hibernate.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const OPEN_TAB_TOOL = {
  type: "function",
  function: {
    name: "openTab",
    description:
      "Open a new browser tab with the given http/https URL (e.g. \"https://google.com\"). " +
      "Use this when the user asks to open, navigate to, or visit a website. " +
      "Only http/https URLs are allowed — never other schemes. This never closes or hibernates anything.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "A full URL starting with https:// (or http://).",
        },
      },
      required: ["url"],
    },
  },
} as const;

export const JUMP_TAB_TOOL = {
  type: "function",
  function: {
    name: "jumpTab",
    description:
      "Activate (focus) an already-open browser tab by its exact title (from the open tabs list). " +
      "Use this instead of openTab when the tab is already open — the user means that tab. " +
      "Activates the first matching tab.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab to activate.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const GROUP_TABS_TOOL = {
  type: "function",
  function: {
    name: "groupTabs",
    description:
      "Group the given open browser tabs (by exact title) into one Chrome tab group. " +
      "Pass an array of exact titles from the open tabs list. Pinned tabs are never grouped.",
    parameters: {
      type: "object",
      properties: {
        titles: {
          type: "array",
          items: { type: "string" },
          description: "Exact titles of the tabs to group.",
        },
      },
      required: ["titles"],
    },
  },
} as const;

export const SAVE_SESSION_TOOL = {
  type: "function",
  function: {
    name: "saveSession",
    description:
      "Save ALL currently open tabs as a session snapshot the user can restore later. " +
      "Use when the user asks to save their session, save for later, or preserve what's open.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A short human name for the session, e.g. \"Deep work\".",
        },
      },
      required: ["name"],
    },
  },
} as const;

export const PIN_TAB_TOOL = {
  type: "function",
  function: {
    name: "pinTab",
    description:
      "Pin one or more open browser tabs by their exact title. Pinned tabs stay open and can never be closed or hibernated from chat.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab(s) to pin.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const UNPIN_TAB_TOOL = {
  type: "function",
  function: {
    name: "unpinTab",
    description:
      "Unpin one or more pinned browser tabs by their exact title, restoring normal close/hibernate behavior.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab(s) to unpin.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const READ_PAGE_TOOL = {
  type: "function",
  function: {
    name: "readPage",
    description:
      "Read the visible content of an open browser tab by its exact title (from the open tabs list). " +
      "Use this when the user asks what's on a page, to summarize a specific tab, or to act on its content. " +
      "You will receive the page text as the tool result — then summarize or answer from it. " +
      "Reading is read-only; nothing is closed, hibernated, or modified.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab to read.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const MUTE_TAB_TOOL = {
  type: "function",
  function: {
    name: "muteTab",
    description:
      "Mute (silence) one or more open browser tabs by their exact title. " +
      "Use this when the user wants quiet — e.g. a video or music tab playing audio. " +
      "Muting is reversible and never closes or unloads anything; pinned tabs may be muted.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab(s) to mute.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const UNMUTE_TAB_TOOL = {
  type: "function",
  function: {
    name: "unmuteTab",
    description:
      "Unmute one or more muted open browser tabs by their exact title. Reverses muteTab.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab(s) to unmute.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const CLOSE_OTHERS_TOOL = {
  type: "function",
  function: {
    name: "closeOtherTabs",
    description:
      "Close every open tab EXCEPT the one with the given exact title (the tab to keep). " +
      "Use when the user asks to close everything else, declutter, or close all but one. " +
      "Pinned tabs are never closed. Nothing closes unless the tab to keep actually exists.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab to KEEP open.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const DUPLICATE_TAB_TOOL = {
  type: "function",
  function: {
    name: "duplicateTab",
    description:
      "Duplicate (open a copy of) an open browser tab by its exact title, " +
      "e.g. when the user wants another instance of the same page. " +
      "Duplicates the first matching tab. Never closes or unloads anything.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The exact title of the tab to duplicate.",
        },
      },
      required: ["title"],
    },
  },
} as const;

export const REOPEN_TAB_TOOL = {
  type: "function",
  function: {
    name: "reopenClosedTab",
    description:
      "Reopen the most recently closed browser tab. Use when the user asks to undo a close, " +
      "reopen what they just closed, or restore a tab they lost. Takes no arguments. " +
      "This never affects currently open tabs.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
} as const;

export const COPY_TABS_TOOL = {
  type: "function",
  function: {
    name: "copyTabUrls",
    description:
      "Copy the titles and URLs of open browser tabs to the clipboard as a text list. " +
      "Pass an array of exact titles to copy only those tabs, or omit titles to copy ALL open tabs. " +
      "Use when the user wants to share links, save them to notes, or paste their tabs elsewhere. " +
      "Read-only — nothing is closed or modified.",
    parameters: {
      type: "object",
      properties: {
        titles: {
          type: "array",
          items: { type: "string" },
          description: "Exact titles of the tabs to copy (optional — default: all open tabs).",
        },
      },
      required: [],
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
 * raw string when parsing failed). Only real open tabs ever match (see
 * `matchTabsByTitle` — exact title plus suffix fallbacks); matches on pinned
 * tabs are reported (skippedPinned) but never closed.
 */
export function resolveCloseTarget(args: unknown, tabs: EnrichedTab[]): CloseTarget {
  const target = resolveTabTarget(args, tabs);
  if ("error" in target) return target;
  return {
    tabs: target.tabs.filter((t) => !t.isPinned),
    skippedPinned: target.tabs.filter((t) => t.isPinned).length,
  };
}

/**
 * Tolerant title match used by every tool resolver. Tries, in order:
 *  1. the exact title (after trim/lowercase);
 *  2. the exact title after stripping a trailing "(domain)" the model may
 *     have echoed from the tab list;
 *  3. an unambiguous PREFIX match — the requested title is a strict prefix of
 *     exactly ONE distinct open-tab title. Models routinely truncate a
 *     trailing site suffix Chrome appends to titles (e.g. "World's Most
 *     Beautiful 4K Video" for a tab titled "... 4K Video - YouTube"), so this
 *     recovers the intended tab without ever inventing one. It refuses
 *     (empty result) when two DIFFERENT tabs share the prefix.
 * Only real open tabs are returned; nothing is invented.
 */
function matchTabsByTitle(title: string, tabs: EnrichedTab[]): EnrichedTab[] {
  const wanted = normalize(title);
  const exact = tabs.filter((t) => normalize(t.title) === wanted);
  if (exact.length > 0) return exact;
  const stripped = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (stripped !== title) {
    const strippedExact = tabs.filter((t) => normalize(t.title) === normalize(stripped));
    if (strippedExact.length > 0) return strippedExact;
  }
  const prefix = normalize(stripped);
  if (prefix.length >= 3) {
    const prefixed = tabs.filter(
      (t) => normalize(t.title).startsWith(prefix) && normalize(t.title) !== prefix,
    );
    if (prefixed.length > 0 && new Set(prefixed.map((t) => normalize(t.title))).size === 1) {
      return prefixed;
    }
  }
  return [];
}

/**
 * Same tolerant resolution as `resolveCloseTarget`, but includes pinned tabs
 * in the result — for non-destructive tools (mute, duplicate) where a pinned
 * tab may be acted on.
 */
export function resolveTabTarget(args: unknown, tabs: EnrichedTab[]): CloseTarget {
  const obj = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;
  const title = obj?.title;
  if (typeof title !== "string" || title.trim() === "") return { error: "missing-title" };
  const matches = matchTabsByTitle(title, tabs);
  if (matches.length === 0) return { error: "no-match" };
  return { tabs: matches, skippedPinned: 0 };
}

/** Human summary of a close-tab result, for the tool card in the thread. */
export function closeResultText(
  result: CloseTarget,
  name: string,
  verb = "closed",
): string {
  if ("error" in result) {
    switch (result.error) {
      case "missing-title":
        return `${name}: no title given — nothing ${verb}`;
      case "no-match":
        return `${name}: no open tab with that title — nothing ${verb}`;
    }
  }
  const closed = result.tabs.map((t) => `${verb} — ${t.title}`).join(" · ");
  const pinnedNote =
    result.skippedPinned > 0 ? ` · ${result.skippedPinned} pinned tab(s) not ${verb}` : "";
  return `${name}: ${closed || `nothing ${verb}`}${pinnedNote}`;
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

const CLOSE_VERBS = "close|closing|closed|closes";
const HIBERNATE_VERBS =
  "hibernate|hibernates|hibernating|hibernated|discard|discards|discarding|discarded";

/**
 * Quoted "… tab" mentions, but only when the claim carries one of `verbs`
 * before the quote ("close the 'Inbox' tab"). A verb-less or
 * mismatched-verb quote is NOT a claim for this action — this keeps a
 * "close" sentence from also producing a "hibernate" chip and vice versa.
 */
function quotedTitles(text: string, verbs: string): string[] {
  const re = new RegExp(
    "\\b(?:" + verbs + ")\\b[^\"'`\\n]{0,60}?[\"'`]([^\"'`\\n]{2,80})[\"'`]\\s+tab\\b",
    "gi",
  );
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

/** Extract quoted or plain "close/closing/closed ... tab" mentions. */
export function extractCloseTitles(text: string): string[] {
  const out = quotedTitles(text, CLOSE_VERBS);
  const plain = new RegExp(`\\b(?:${CLOSE_VERBS})\\b\\s+(?:the\\s+)?([^"'` + "`" + `\\n.!?]{2,80}?)\\s+tab\\b`, "gi");
  for (const m of text.matchAll(plain)) out.push(m[1].trim());
  return out;
}

/**
 * Resolve every close-claim in the assistant's text against the live tab
 * list (tolerant matching via `matchTabsByTitle` — exact, "(domain)"-stripped,
 * unambiguous prefix). The chip shows the real open-tab title. Pinned tabs are
 * never proposed. Returns [] when nothing resolves — the UI shows no chip.
 */
export function detectCloseProposals(text: string, tabs: EnrichedTab[]): CloseProposal[] {
  const seen = new Set<string>();
  const out: CloseProposal[] = [];
  for (const raw of extractCloseTitles(text)) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const target = resolveCloseTarget({ title: raw }, tabs);
    if ("tabs" in target && target.tabs.length > 0) {
      out.push({ title: target.tabs[0].title, tabIds: target.tabs.map((t) => t.id) });
    }
  }
  return out;
}

// ─── open-URL tool (agentic browse — open a website, nothing destructive) ────

export type OpenTarget = { url: string } | { error: "missing-url" | "invalid-url" };

/**
 * Validate a model-produced `openTab` call. Bare domains get `https://`
 * prepended (models rarely pass the scheme); anything that isn't a valid
 * http/https URL — javascript:, chrome:, data:, garbage — is refused.
 * Opening is benign, so this is the only gate: no tab-store lookups.
 */
export function resolveOpenUrl(args: unknown): OpenTarget {
  const obj = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;
  const raw = obj?.url;
  if (typeof raw !== "string" || raw.trim() === "") return { error: "missing-url" };
  let url = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\//i.test(url)) return { error: "invalid-url" };
  try {
    new URL(url);
  } catch {
    return { error: "invalid-url" };
  }
  return { url };
}

/** Human summary of an open-tab result, for the tool card in the thread. */
export function openResultText(result: OpenTarget): string {
  if ("error" in result) {
    return result.error === "missing-url"
      ? "openTab: no URL given — nothing opened"
      : "openTab: invalid URL — nothing opened";
  }
  return `openTab: opened — ${result.url}`;
}

// ─── jump / group / save / pin — tab-control tools ───────────────────────────

/**
 * Human summary of a jump-tab result. Only the first match is activated;
 * extra duplicates are mentioned, not activated.
 */
export function jumpResultText(result: CloseTarget, name = "jumpTab"): string {
  if ("error" in result) {
    return result.error === "missing-title"
      ? `${name}: no title given — nothing activated`
      : `${name}: no open tab with that title — nothing activated`;
  }
  if (result.tabs.length === 0) {
    return result.skippedPinned > 0
      ? `${name}: nothing activated · ${result.skippedPinned} pinned tab(s) not activated`
      : `${name}: nothing activated`;
  }
  const extra =
    result.tabs.length > 1 ? ` (${result.tabs.length - 1} duplicate(s) not activated)` : "";
  const pinnedNote =
    result.skippedPinned > 0 ? ` · ${result.skippedPinned} pinned tab(s) not activated` : "";
  return `${name}: activated — ${result.tabs[0].title}${extra}${pinnedNote}`;
}

export type GroupTarget =
  | { tabIds: number[]; groupedTitles: string[]; skippedPinned: number }
  | { error: "missing-titles" | "no-match" };

/**
 * Validate a model-produced `groupTabs` call. Every title is resolved with
 * the same exact-title rules as closeTab; unresolvable titles are skipped
 * (their absence shows up in the result count), pinned never grouped.
 */
export function resolveGroupTarget(args: unknown, tabs: EnrichedTab[]): GroupTarget {
  const obj = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;
  const titles = obj?.titles;
  if (!Array.isArray(titles) || titles.length === 0) return { error: "missing-titles" };
  const tabIds: number[] = [];
  const groupedTitles: string[] = [];
  let skippedPinned = 0;
  for (const raw of titles) {
    if (typeof raw !== "string") continue;
    const target = resolveCloseTarget({ title: raw }, tabs);
    if ("tabs" in target) {
      skippedPinned += target.skippedPinned;
      for (const t of target.tabs) {
        if (!tabIds.includes(t.id)) {
          tabIds.push(t.id);
          groupedTitles.push(t.title);
        }
      }
    }
  }
  if (tabIds.length === 0) return { error: "no-match" };
  return { tabIds, groupedTitles, skippedPinned };
}

/** Human summary of a group-tabs result. */
export function groupResultText(result: GroupTarget, name = "groupTabs"): string {
  if ("error" in result) {
    return result.error === "missing-titles"
      ? `${name}: no titles given — nothing grouped`
      : `${name}: no open tab matched any title — nothing grouped`;
  }
  const titles = result.groupedTitles.join(" · ");
  const pinnedNote =
    result.skippedPinned > 0 ? ` · ${result.skippedPinned} pinned tab(s) not grouped` : "";
  return `${name}: grouped ${result.tabIds.length} tab(s) — ${titles}${pinnedNote}`;
}

/** Human summary of a save-session result. */
export function saveSessionResultText(count: number, name: string): string {
  return `saveSession: saved ${count} tab(s) as "${name}"`;
}

// ─── readPage — read-only page content for the model ─────────────────────────

/** Page-text cap fed to the model in the tool result (chat context is precious). */
export const READ_PAGE_TEXT_CAP = 4000;

/** Human summary of a readPage refusal. */
export function readPageRefusalText(reason: "no-permission" | "unreadable"): string {
  return reason === "no-permission"
    ? 'readPage: page-reading is off — enable "Read Pages for AI" in Settings'
    : "readPage: couldn't read that page (restricted or unavailable) — nothing happened";
}

/** Tool-result payload for a successful read: title + truncated page text. */
export function readPageSuccessText(title: string, text: string, cap = READ_PAGE_TEXT_CAP): string {
  return `readPage: content of "${title}" (truncated):\n${truncatePageText(text, cap)}`;
}

// ─── hibernate claims (parallel to close — same rules, different tool) ───────

/** Extract quoted or plain "hibernate/discard … tab" mentions. */
export function extractHibernateTitles(text: string): string[] {
  const out = quotedTitles(text, HIBERNATE_VERBS);
  const plain = new RegExp(
    `\\b(?:${HIBERNATE_VERBS})\\b\\s+(?:the\\s+)?([^"'` + "`" + `\\n.!?]{2,80}?)\\s+tab\\b`,
    "gi",
  );
  for (const m of text.matchAll(plain)) out.push(m[1].trim());
  return out;
}

/**
 * Resolve every hibernate-claim in the assistant's text against the live tab
 * list (same rules as `detectCloseProposals`; chip shows the real tab title;
 * pinned never proposed). Returns [] when nothing resolves.
 */
export function detectHibernateProposals(text: string, tabs: EnrichedTab[]): CloseProposal[] {
  const seen = new Set<string>();
  const out: CloseProposal[] = [];
  for (const raw of extractHibernateTitles(text)) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const target = resolveCloseTarget({ title: raw }, tabs);
    if ("tabs" in target && target.tabs.length > 0) {
      out.push({ title: target.tabs[0].title, tabIds: target.tabs.map((t) => t.id) });
    }
  }
  return out;
}

// ─── closeOtherTabs — keep one title, close everything else ──────────────────

export type CloseOthersTarget =
  | { closedTabs: EnrichedTab[]; keptTitle: string; keptPinned: number; closedPinned: number }
  | { error: "missing-title" | "no-match" };

/**
 * Validate a model-produced `closeOtherTabs` call. The given title is the
 * tab to KEEP — nothing closes unless it resolves (a typo must never wipe
 * the session). Pinned tabs are never closed (kept, and reported).
 */
export function resolveCloseOthersTarget(args: unknown, tabs: EnrichedTab[]): CloseOthersTarget {
  const obj = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;
  const title = obj?.title;
  if (typeof title !== "string" || title.trim() === "") return { error: "missing-title" };
  const keep = matchTabsByTitle(title, tabs);
  if (keep.length === 0) return { error: "no-match" };
  const keepIds = new Set(keep.map((t) => t.id));
  const closedTabs = tabs.filter((t) => !keepIds.has(t.id) && !t.isPinned);
  const closedPinned = tabs.filter((t) => !keepIds.has(t.id) && t.isPinned).length;
  return {
    closedTabs,
    keptTitle: keep[0].title,
    keptPinned: keep.filter((t) => t.isPinned).length,
    closedPinned,
  };
}

/** Human summary of a close-others result. */
export function closeOthersResultText(result: CloseOthersTarget, name = "closeOtherTabs"): string {
  if ("error" in result) {
    return result.error === "missing-title"
      ? `${name}: no title given — nothing closed`
      : `${name}: no open tab with that title to keep — nothing closed`;
  }
  const closed = result.closedTabs.map((t) => `closed — ${t.title}`).join(" · ");
  const pinnedNote =
    result.closedPinned > 0 ? ` · ${result.closedPinned} pinned tab(s) kept` : "";
  return `${name}: kept "${result.keptTitle}" — ${closed || "nothing else open"}${pinnedNote}`;
}

// ─── copyTabUrls — share links to the clipboard ──────────────────────────────

export type CopyTarget =
  | { tabs: EnrichedTab[]; skipped: number }
  | { error: "no-match" };

/**
 * Validate a model-produced `copyTabUrls` call. Omitted `titles` copies ALL
 * open tabs; a `titles` array copies the resolved matches (unresolvable
 * titles are skipped and reported). Nothing to copy → error.
 */
export function resolveCopyTitles(args: unknown, tabs: EnrichedTab[]): CopyTarget {
  const obj = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : null;
  const titles = obj?.titles;
  if (!Array.isArray(titles) || titles.length === 0) {
    return { tabs, skipped: 0 };
  }
  const out: EnrichedTab[] = [];
  const seen = new Set<number>();
  let skipped = 0;
  for (const raw of titles) {
    if (typeof raw !== "string") {
      skipped++;
      continue;
    }
    const target = resolveTabTarget({ title: raw }, tabs);
    if ("tabs" in target) {
      for (const t of target.tabs) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
    } else {
      skipped++;
    }
  }
  if (out.length === 0) return { error: "no-match" };
  return { tabs: out, skipped };
}

/** Human summary of a copy result. */
export function copyResultText(result: CopyTarget, name = "copyTabUrls"): string {
  if ("error" in result) return `${name}: no open tab matched any title — nothing copied`;
  const skippedNote = result.skipped > 0 ? ` (${result.skipped} unmatched skipped)` : "";
  return `${name}: copied ${result.tabs.length} link(s) to the clipboard${skippedNote}`;
}
