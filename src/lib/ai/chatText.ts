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
