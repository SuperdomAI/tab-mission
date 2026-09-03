/**
 * Ask AI sidebar — reply hygiene.
 *
 * Small local models (e.g. mistral) sometimes "narrate" tool use as a fenced
 * code block (`closeTab(Inbox)`) instead of emitting a real tool call. The
 * system prompt forbids markdown, but the render layer still strips any code
 * fences that slip through, so the thread never shows raw ``` blocks.
 */

/** Remove fenced code blocks and unwrap inline backticks. */
export function stripCodeFences(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`\n]+)`/g, "$1");
}

/** Collapse 3+ blank lines to one and trim. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Full assistant-reply clean: fences out, blank lines collapsed, trimmed. */
export function cleanAssistantText(text: string): string {
  return collapseBlankLines(stripCodeFences(text));
}

// ─── context compaction (small local windows need it) ────────────────────────

import type { ChatMessageFull } from "../ollama";

/** Keep the transcript (system prompt included) under this estimated budget. */
export const CHAT_CONTEXT_MAX_TOKENS = 3000;

/** System note inserted where older turns were dropped. */
export const COMPACTION_NOTE =
  "[Earlier messages in this conversation were trimmed to fit the context window — continue as if nothing happened, keep answers brief.]";

/** Rough token estimate (~4 chars per token for UI/English text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Drop the OLDEST turns until the transcript fits `maxTokens`, then prepend
 * a system note so the model knows history was trimmed. Never empties the
 * transcript: the newest message (the current question) always survives.
 * Returns the trimmed copy + how many messages were dropped; the caller
 * decides whether to surface the note in the thread.
 */
export function compactMessages(
  messages: ChatMessageFull[],
  maxTokens: number = CHAT_CONTEXT_MAX_TOKENS,
): { messages: ChatMessageFull[]; trimmed: number } {
  const size = (msgs: ChatMessageFull[]) =>
    msgs.reduce((n, m) => n + estimateTokens(m.content), 0);
  let kept = [...messages];
  let trimmed = 0;
  while (kept.length > 1 && size(kept) > maxTokens) {
    kept.shift();
    trimmed++;
  }
  if (trimmed > 0) {
    kept.unshift({ role: "system", content: COMPACTION_NOTE });
  }
  return { messages: kept, trimmed };
}
